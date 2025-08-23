// Node.jsの標準モジュールをインポート
const fs = require('fs');
const path = require('path');

/**
 * CSVテキストをオブジェクトの配列に変換するヘルパー関数
 * @param {string} csvText - CSV形式の文字列
 * @returns {Array<Object>} 変換されたオブジェクトの配列
 */
const parseCSV = (csvText) => {
    // BOM (Byte Order Mark) を除去
    const text = csvText.startsWith('\uFEFF') ? csvText.substring(1) : csvText;
    const lines = text.trim().split(/\r?\n/); // WindowsとUnixの改行コードに対応
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const entry = {};
        headers.forEach((header, index) => {
            entry[header] = values[index];
        });
        return entry;
    });
};

// 以下はサーバーレス関数のエントリーポイント
exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ message: 'Method Not Allowed' }) };
    }

    try {
        // --- CSVファイルの読み込み処理 ---
        const csvFilePath = path.resolve(__dirname, 'student-data.csv');
        
        if (!fs.existsSync(csvFilePath)) {
            console.error('データファイルが見つかりません: student-data.csv');
            return { statusCode: 500, body: JSON.stringify({ success: false, message: 'サーバー設定エラーです。' }) };
        }

        const csvText = fs.readFileSync(csvFilePath, 'utf-8');
        const studentData = parseCSV(csvText);
        // --- 読み込み処理ここまで ---

        const { examNumber, password } = JSON.parse(event.body);
        if (!examNumber || !password) {
            return { statusCode: 400, body: JSON.stringify({ success: false, message: '受験番号とパスワードを入力してください。' }) };
        }

        const student = studentData.find(s => s.examNumber === examNumber && s.password === password);

        if (student) {
            // 認証成功：パスワード以外の必要な情報を返す
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
        console.error('エラーが発生しました:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: 'サーバーでエラーが発生しました。' }),
        };
    }
};
