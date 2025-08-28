const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Netlifyの環境変数から設定を読み込む
const { GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS_JSON, GOOGLE_SHEET_NAME, GOOGLE_HISTORY_SHEET_NAME } = process.env;

// 以下はサーバーレス関数のエントリーポイント
exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // 環境変数がすべて設定されているか確認
    if (!GOOGLE_SHEET_ID || !GOOGLE_CREDENTIALS_JSON || !GOOGLE_SHEET_NAME || !GOOGLE_HISTORY_SHEET_NAME) {
        console.error('必要な環境変数が設定されていません。');
        return { statusCode: 500, body: JSON.stringify({ success: false, message: 'サーバー設定エラーです。' }) };
    }

    try {
        // --- Google Sheets API 認証 ---
        const creds = JSON.parse(GOOGLE_CREDENTIALS_JSON);
        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        // --- ユーザー認証 (linked-dataシートから読み取り) ---
        const studentSheet = doc.sheetsByTitle[GOOGLE_SHEET_NAME];
        if (!studentSheet) {
            console.error(`'${GOOGLE_SHEET_NAME}' という名前のシートが見つかりません。`);
            return { statusCode: 500, body: JSON.stringify({ success: false, message: 'サーバーデータエラーです。' }) };
        }
        const studentRows = await studentSheet.getRows();
        
        const { examNumber, password } = JSON.parse(event.body);
        if (!examNumber || !password) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: '受験番号とパスワードを入力してください。' }) };
        }

        const student = studentRows.find(row => {
            const num = row.get('examNumber');
            const pass = row.get('password');
            return num && num.toString().trim() === examNumber.toString().trim() && pass && pass.toString() === password;
        })?.toObject();

        if (student) {
            // ▼▼▼ ログイン記録の書き込み処理 ▼▼▼
            try {
                const historySheet = doc.sheetsByTitle[GOOGLE_HISTORY_SHEET_NAME];
                if (!historySheet) {
                    console.error(`'${GOOGLE_HISTORY_SHEET_NAME}' という名前のシートが見つかりません。`);
                } else {
                    await historySheet.loadHeaderRow();
                    const historyRows = await historySheet.getRows();
                    
                    // ▼▼▼ 原因調査のための詳細ログ ▼▼▼
                    console.log(`--- STARTING SEARCH IN login-history FOR examNumber: "${examNumber}" ---`);
                    const historyRow = historyRows.find(row => {
                        const numInSheet = row.get('examNumber');
                        if (!numInSheet) return false;

                        const numAsString = numInSheet.toString().trim();
                        const inputAsString = examNumber.toString().trim();
                        const isMatch = numAsString === inputAsString;
                        
                        // 各行の比較結果をログに出力
                        console.log(`Comparing sheet value: "${numAsString}" (type: ${typeof numInSheet}) with input: "${inputAsString}". Match: ${isMatch}`);
                        return isMatch;
                    });
                    console.log(`--- FINISHED SEARCH ---`);
                    // ▲▲▲ 原因調査ログここまで ▲▲▲

                    if (historyRow) {
                        const rowIndex = historyRow.rowIndex - 1;
                        await historySheet.loadCells({
                            startRowIndex: rowIndex, endRowIndex: rowIndex + 1,
                            startColumnIndex: 0, endColumnIndex: historySheet.headerValues.length
                        });

                        const now = new Date();
                        const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
                        const timestamp = jstNow.toISOString().slice(0, 19).replace('T', ' ');

                        const loginCountIndex = historySheet.headerValues.indexOf('loginCount');
                        if (loginCountIndex !== -1) {
                            const loginCountCell = historySheet.getCell(rowIndex, loginCountIndex);
                            const currentCount = parseInt(loginCountCell.value, 10) || 0;
                            loginCountCell.value = currentCount + 1;
                        }

                        const firstLoginIndex = historySheet.headerValues.indexOf('firstLogin');
                        if (firstLoginIndex !== -1) {
                            const firstLoginCell = historySheet.getCell(rowIndex, firstLoginIndex);
                            if (!firstLoginCell.value) {
                                firstLoginCell.value = timestamp;
                            }
                        }

                        const lastLoginIndex = historySheet.headerValues.indexOf('lastLogin');
                        if (lastLoginIndex !== -1) {
                            const lastLoginCell = historySheet.getCell(rowIndex, lastLoginIndex);
                            lastLoginCell.value = timestamp;
                        }

                        await historySheet.saveUpdatedCells();
                        console.log(`Successfully updated cells for examNumber: ${examNumber}`);
                    } else {
                        console.warn(`login-historyシートに受験番号'${examNumber}'の記録が見つかりませんでした。`);
                    }
                }
            } catch (writeError) {
                console.error('ログイン情報の書き込みに失敗しました:', writeError.message);
            }
            // ▲▲▲ 書き込み処理ここまで ▲▲▲

            // 認証成功
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    success: true,
                    data: {
                        examNumber: student.examNumber,
                        lastName: student.lastName,
                        firstName: student.firstName,
                        examDate: student.examDate,
                        meetingTime: student.meetingTime,
                        examPeriod: student.examPeriod
                    }
                }),
            };
        } else {
            // 認証失敗
            return {
                statusCode: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: false, message: '受験番号またはパスワードが正しくありません。' }),
            };
        }

    } catch (error) {
        console.error('APIエラー:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'サーバーでエラーが発生しました。' }),
        };
    }
};
