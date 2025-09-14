//npm install axios jsdom fast-csv
const axios = require('axios');
const { JSDOM } = require('jsdom');
const csv = require('fast-csv');
const fs = require('fs');
const { URL } = require('url');

// --- 設定項目 ---
// クロールを開始する基点URLを指定。このURLで始まるリンクのみを辿ります。
// 末尾にスラッシュを付けることを推奨します (例: 'https://example.com/about/')
const START_URL = 'https://example.com/about/'; 
// 結果を出力するCSVファイルのパスを指定
const OUTPUT_CSV_FILE = './all_broken_links.csv';
// ----------------

const visitedUrls = new Set();
// キューにはURLだけでなく、どこからリンクされていたか(referrer)も保存
const queue = [{ url: START_URL, referrer: 'START_URL' }];
// 画像とページ、両方のリンク切れ情報をここに集約
const allBrokenLinks = [];

const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
};

/**
 * リンク切れ情報をコンソールに整形して出力する
 * @param {object} linkInfo - リンク切れ情報のオブジェクト
 */
const logToConsole = (linkInfo) => {
    console.log(`\n--- ⚠️ BROKEN LINK FOUND ---`);
    console.log(`  Type       : ${linkInfo.type}`);
    console.log(`  URL        : ${linkInfo.brokenUrl}`);
    console.log(`  Found On   : ${linkInfo.referrer}`);
    if (linkInfo.pageTitle) {
        console.log(`  Page Title : ${linkInfo.pageTitle}`);
    }
    console.log(`---------------------------\n`);
};

/**
 * ページをクロールし、リンクと画像を処理する
 * @param {string} currentUrl - 現在クロール中のページのURL
 * @param {string} referrer - このページへのリンク元URL
 */
const crawlPage = async (currentUrl, referrer) => {
    if (visitedUrls.has(currentUrl)) {
        return;
    }
    console.log(`🔎 Crawling: ${currentUrl}`);
    visitedUrls.add(currentUrl);

    try {
        const response = await axios.get(currentUrl, axiosConfig);
        const dom = new JSDOM(response.data);
        const document = dom.window.document;
        const pageTitle = document.querySelector('title')?.textContent.trim() || 'No Title';

        // ページ内のリンクを収集
        document.querySelectorAll('a').forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            const absoluteUrl = new URL(href, currentUrl).href;
            if (absoluteUrl.startsWith(START_URL) && !visitedUrls.has(absoluteUrl) && !queue.some(item => item.url === absoluteUrl)) {
                queue.push({ url: absoluteUrl, referrer: currentUrl });
            }
        });
        
        // ページ内の画像をチェック
        const imageChecks = [];
        document.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src');
            if (!src || src.startsWith('data:')) return;
            const absoluteImageUrl = new URL(src, currentUrl).href;
            imageChecks.push(checkImageStatus(absoluteImageUrl, currentUrl, pageTitle));
        });
        await Promise.all(imageChecks);

    } catch (error) {
        if (error.response && error.response.status === 404) {
            const brokenLinkInfo = {
                type: 'Page',
                brokenUrl: currentUrl,
                referrer: referrer,
                pageTitle: null
            };
            allBrokenLinks.push(brokenLinkInfo);
            logToConsole(brokenLinkInfo); // 逐次画面に出力
        } else {
            console.error(`❌ Error crawling ${currentUrl}: ${error.message}`);
        }
    }
};

/**
 * 画像のURLのステータスをチェックする
 * @param {string} imageUrl - チェックする画像のURL
 * @param {string} pageUrl - 画像が配置されているページのURL
 * @param {string} pageTitle - 画像が配置されているページのタイトル
 */
const checkImageStatus = async (imageUrl, pageUrl, pageTitle) => {
    try {
        await axios.head(imageUrl, axiosConfig);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            const brokenLinkInfo = {
                type: 'Image',
                brokenUrl: imageUrl,
                referrer: pageUrl,
                pageTitle: pageTitle
            };
            allBrokenLinks.push(brokenLinkInfo);
            logToConsole(brokenLinkInfo); // 逐次画面に出力
        }
    }
};

/**
 * メイン処理
 */
const main = async () => {
    console.log(`🚀 Starting crawl from directory: ${START_URL}`);

    while (queue.length > 0) {
        const { url, referrer } = queue.shift();
        await crawlPage(url, referrer);
    }

    if (allBrokenLinks.length > 0) {
        console.log(`\n✅ Crawl finished. Found ${allBrokenLinks.length} broken links. Writing to ${OUTPUT_CSV_FILE}...`);
        
        // CSV用のデータ形式に変換
        const csvData = allBrokenLinks.map(item => ({
            Type: item.type,
            Broken_URL: item.brokenUrl,
            Found_On_Page: item.referrer,
            Page_Title: item.pageTitle || 'N/A'
        }));

        const ws = fs.createWriteStream(OUTPUT_CSV_FILE);
        csv.write(csvData, { headers: true })
            .pipe(ws)
            .on('finish', () => console.log('📁 CSV file written successfully.'));
    } else {
        console.log('\n✅ Crawl finished. No broken links found!');
    }
};

main();