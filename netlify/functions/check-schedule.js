const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Netlifyの環境変数から設定を読み込む
const { GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS_JSON, GOOGLE_SHEET_NAME } = process.env;

// 以下はサーバーレス関数のエントリーポイント
exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    // 環境変数が設定されているか確認
    if (!GOOGLE_SHEET_ID || !GOOGLE_CREDENTIALS_JSON || !GOOGLE_SHEET_NAME) {
        console.error('環境変数が設定されていません。(GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS_JSON, GOOGLE_SHEET_NAME)');
        return { statusCode: 500, body: JSON.stringify({ success: false, message: 'サーバー設定エラーです。' }) };
    }

    try {
        // --- Google Sheets API 認証 ---
        const creds = JSON.parse(GOOGLE_CREDENTIALS_JSON);
        const serviceAccountAuth = new JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
        
        // --- スプレッドシートからデータを読み込み ---
        await doc.loadInfo();
        // ★シートを「インデックス番号」ではなく「名前」で取得するように変更
        const sheet = doc.sheetsByTitle[GOOGLE_SHEET_NAME]; 
        
        // 指定された名前のシートが存在しない場合のエラーハンドリング
        if (!sheet) {
            console.error(`'${GOOGLE_SHEET_NAME}' という名前のシートが見つかりません。`);
            return { statusCode: 500, body: JSON.stringify({ success: false, message: 'サーバーデータエラーです。' }) };
        }

        const rows = await sheet.getRows();
        const studentData = rows.map(row => row.toObject());

        // --- ユーザー認証 ---
        const { examNumber, password } = JSON.parse(event.body);
        if (!examNumber || !password) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: '受験番号とパスワードを入力してください。' }) };
        }

        const student = studentData.find(s => s.examNumber === examNumber && s.password === password);

        if (student) {
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
