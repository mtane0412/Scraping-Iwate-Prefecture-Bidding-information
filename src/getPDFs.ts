import { launch } from 'puppeteer';
import * as path from 'path';
import * as log4js from "log4js";


const logPath = path.join(process.pkg ? `${path.dirname(process.execPath)}/logs/` : `${process.cwd()}/logs/`);

log4js.configure({
  appenders : {
    stdout: { type: 'stdout' },
    system : {type : 'dateFile', filename : logPath + 'system/system', pattern: '-yyyy-MM-dd.log', alwaysIncludePattern: "true"},
    error : {type : 'file', filename : logPath + 'debug/error.log'},
    debug : {type : 'file', filename : logPath + 'debug/debug.log'}
  },
  categories : {
    default : {appenders : ['system', 'stdout'], level : 'info'},
    error : {appenders : ['error', 'stdout'], level: 'warn'},
    debug : {appenders : ['debug', 'stdout'], level : 'debug'}
  }
});

const systemLogger = log4js.getLogger('system');
const errorLogger = log4js.getLogger('error');
const debugLogger = log4js.getLogger('debug');


const getPDFs = async (): Promise<string> => {
  process.on('unhandledRejection', (reason, promise) => {
    errorLogger.error(reason);
    process.exit(1);
  });
  
  const browser = await launch({
    headless: true,
    //slowMo: 50,
    defaultViewport: {
      width: 1280,
      height: 882
    },
    args: [
      '--no-sandbox',
      '--disable-features=site-per-process'
    ],
    channel: 'chrome'
  });
  const page = (await browser.pages())[0];
  await page.setUserAgent('bot');
  // console.logデバッグしたいときに
  page.on('console', msg => console.log(msg.text()));

  const res = await page.goto('https://www.epi-cloud.fwd.ne.jp/koukai/do/KF001ShowAction?name1=0620060006600600', {waitUntil: "domcontentloaded"});
  if (!res.ok()) {
    errorLogger.error('入札情報公開サービスに接続できませんでした');
    return
  }

  const cdpSession = await page.target().createCDPSession();

  const downloaded = new Promise<void>((resolve, reject) => {
    cdpSession.on(
      "Browser.downloadProgress",
      (params: { state: "inProgress" | "completed" | "canceled" }) => {
        if (params.state == "completed") {
          resolve();
        } else if (params.state == "canceled") {
          reject("download cancelled");
        }
      }
    );
  });

  await cdpSession.send('Fetch.enable', { // Fetchを有効に
    patterns: [{ urlPattern: '*', requestStage: 'Response' }] // ResponseステージをFetch
  });

  cdpSession.on('Fetch.requestPaused', async (requestEvent) => { // ここで要求を一時停止
    const { requestId } = requestEvent;
    let responseHeaders = requestEvent.responseHeaders || [];
    let contentType = responseHeaders.filter(
        header => header.name.toLowerCase() === 'content-type')[0].value;

    // pdfとxml以外はそのまま
    if (!contentType.endsWith('pdf') && !contentType.endsWith('xml')) {
        await cdpSession.send('Fetch.continueRequest', { requestId }); // リクエストを続行
        return;
    }

    // pdfとxmlの場合は`content-disposition: attachment`をつける
    responseHeaders.push({ name: 'content-disposition', value: 'attachment' });
    const response = await cdpSession.send('Fetch.getResponseBody', { requestId }); // bodyを取得
    await cdpSession.send('Fetch.fulfillRequest', // レスポンスを指定
        { requestId, responseCode: 200, responseHeaders, body: response.body });
  });


  
  page.on('dialog', async dialog => {
    /* 無指定検索時の確認をOKにする */
    dialog.accept(); // OK
  });

  await page.setRequestInterception(true);
  page.on('request', request => {
      const requestType = request.resourceType();
      const requestMethod = request.method();
      const requestUrl = request.url();
      if(requestType === 'document' && requestMethod === 'POST') console.log(requestUrl);
      request.continue();
  });

  page.on('framedetached', (frame) => {
    // for debug
    // console.log('Frame detached: ' + frame.name());
  });

  // トップメニュー > コンサルをクリック
  await Promise.all([
    page.waitForNavigation(),
    page.click('[onclick="jsLink2(2);"]')
  ]);


  const frame = page.frames().find(f => f.name() === 'frmRIGHT');
  
  // 入札情報の閲覧 > 発注情報の検索をクリック 
  await Promise.all([
    frame.waitForNavigation(),
    frame.click('[onclick="jskfcLink(4);"]')
  ]);

  // 発注情報検索: 表示件数を1ページ100件に
  await frame.select('select[name="A300"]', '040');

  // 発注情報検索: 業務名に「設計」を入力
  await frame.type('[name="koujimei"]', "設計");

  // 発注情報検索: 検索ボタンをクリック
  await Promise.all([
    frame.waitForNavigation(),
    frame.click('[onclick="doSearch1();"]')
  ]);


  // 発注情報検索: 業務をクリック
  let elementHandle = await frame.$('#frmMain');
  const frame2 = await elementHandle.contentFrame();

  const folderName:string = await frame2.evaluate(() => {
    const contactId:string = document.querySelector('.left.listCol3').textContent;
    const contactName:string = document.querySelector('.left.listCol2 a').textContent;
    return (contactId + '_' + contactName).replace(/\s/g, '')
  });

  await Promise.all([
    frame.waitForNavigation(),
    frame2.click('a[href^="javascript:doEdit(')
  ]);

  const downloadPath = path.join(process.pkg ? `${path.dirname(process.execPath)}/data/${folderName}/` : `${process.cwd()}/data/${folderName}/`);
  await cdpSession.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath,
    eventsEnabled: true,
  });

  systemLogger.info('フォルダ作成: ' + downloadPath);

  type DownloadResult = {
    downloaded: Array<string>;
    notDownloaded: Array<string>;
  }

  
  const downloadResult:DownloadResult = await frame.evaluate(async (btnSelector) => {
    // this executes in the page

    const downloaded:Array<string> = [];
    const notDownloaded:Array<string> = [];

    const links = document.querySelectorAll(btnSelector);
    const keywords:Array<string> = ['入札公告', '位置図', '図面', '参考資料'];
    for (let i=0; i<links.length; i++) {
      const fileName:string = await links[i].textContent.replace(/\s/g, '');
      const isDownloadTarget:Boolean = typeof keywords.find(keyword => fileName.match(keyword)) !== 'undefined';
      if(isDownloadTarget) {
        // ダウンロード対象のPDFだけをダウンロード
        links[i].click(); 
        const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
        await sleep(1000);
        downloaded.push(fileName);
      } else {
        // ダウンロード対象以外はスキップ
        if(fileName !== '') notDownloaded.push(fileName);
        continue;
      }
    }
    return {downloaded, notDownloaded}
  }, 'a[href^="javascript:download"]');

  
  systemLogger.info(downloadResult);

  await Promise.race([
    downloaded,
    new Promise<boolean>((_resolve, reject) => {
      setTimeout(() => {
        reject("download timed out");
      }, 6000);
    }),
  ]);

  await browser.close();

  return;
};

(async () => {
  // npx ts-node src/test.ts
  await getPDFs().then(() => {
    // systemLogger.info("ダウンロード完了");
    // It is optional - if comment out is, node.js get same result
    process.exit(0); 
}).catch(error => {
    errorLogger.error(error);
});
})();
