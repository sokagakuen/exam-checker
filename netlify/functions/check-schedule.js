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

        const student = studentRows.find(row => row.get('examNumber') === examNumber && row.get('password') === password)?.toObject();

        if (student) {
            // ▼▼▼ ログイン記録の書き込み処理 (login-historyシートの既存行を更新) ▼▼▼
            try {
                const historySheet = doc.sheetsByTitle[GOOGLE_HISTORY_SHEET_NAME];
                if (!historySheet) {
                    console.error(`'${GOOGLE_HISTORY_SHEET_NAME}' という名前のシートが見つかりません。`);
                } else {
                    const historyRows = await historySheet.getRows();
                    let historyRow = historyRows.find(row => row.get('examNumber') === examNumber);

                    if (historyRow) {
                        // 既存の記録を更新
                        // ★ examNumber, lastName, firstName は更新せず、以下の3列のみを更新します
                        const now = new Date();
                        const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
                        const timestamp = jstNow.toISOString().slice(0, 19).replace('T', ' ');

                        const currentCount = parseInt(historyRow.get('loginCount'), 10) || 0;
                        const firstLogin = historyRow.get('firstLogin');

                        historyRow.set('loginCount', currentCount + 1);
                        // firstLoginが空の場合のみ、初回ログイン日時を記録
                        if (!firstLogin) {
                            historyRow.set('firstLogin', timestamp);
                        }
                        historyRow.set('lastLogin', timestamp);
                        await historyRow.save(); // 変更を保存
                    } else {
                        // データが事前に準備されている前提のため、ここに来た場合はデータ不整合
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
