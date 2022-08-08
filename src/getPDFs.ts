import { Browser, launch } from 'puppeteer';
import * as path from 'path';
import * as log4js from 'log4js';
import * as fs from 'fs';
import * as toml from 'toml';

// exeとnodeで実行パスを変える
const executionPath = path.join(process.pkg ? path.dirname(process.execPath) : process.cwd());

/*
  config
*/
type Config = {
  topPage: string;
  pdfKeywords: string[];
  projectTitle: string;
}
let config:Config;
try {
  config = toml.parse(fs.readFileSync(executionPath + '/config.toml', 'utf8'));
} catch (error) {
  console.log('tomlファイルなし、デフォルト設定')
  config = {
    topPage: "https://www.epi-cloud.fwd.ne.jp/koukai/do/KF001ShowAction?name1=0620060006600600",
    pdfKeywords:  [
      "公告",
      "位置図",
      "図面",
      "参考資料"
    ],
    projectTitle: "設計"
  }
}

const topPage:string = config.topPage; // 岩手県入札情報公開トップページ
const pdfKeywords:string[] = config.pdfKeywords; // このキーワードを含むPDFをダウンロードする
const projectTitle:string = config.projectTitle; // この業務名を含むものに絞る
console.log('業務名「' + projectTitle + '」を含む案件から、「' + pdfKeywords.join(', ') + '」をタイトルに含むPDFをダウンロードします');

// sleep関数
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// PDFダウンロードチェック関数
const downloadCheck = (downloadHistory: DownloadEvent[]) => {
  // ダウンロード履歴を参照して存在していないファイルがあるプロジェクトのリストを返す
  type failedDownload = {
    contractId: string;
    contractName: string;
    fileName: string;
  }
  const failedDownloads:failedDownload[] = [];
  downloadHistory.forEach(contract=> {
    const contractId:string = contract.contractId;
    const contractName:string = contract.contractName;
    const folderName:string = contractId + '_' + contractName;
    const downloadPath:string = `${executionPath}/data/${folderName}/`;
    for (let i=0;i<contract.downloaded.length; i++) {
      const fileName = contract.downloaded[i];
      const pdfPath = downloadPath + fileName;
      const pdfExists:boolean = fs.existsSync(pdfPath);
      if (!pdfExists) {
        console.log('not exist:' + pdfPath);
        failedDownloads.push({contractId, contractName, fileName});
      }
    }
  })
  //console.table(failedDownloads);
  if (failedDownloads.length === 0) {
    console.log('ダウンロードが正常に終了しました。')
  } else {
    console.log('以下のファイルがダウンロードに失敗した可能性があります。')
    console.table(failedDownloads);
  };
  return failedDownloads
}

/*
  log出力用
*/

const logPath = `${executionPath}/logs/`;


log4js.configure({
  appenders : {
    stdout: { type: 'stdout' },
    system : {type : 'dateFile', filename : logPath + 'system/system', pattern: 'yyyy-MM-dd.log', alwaysIncludePattern: "true"},
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

/*
  ダウンロード履歴用
*/

type DownloadEvent = {
  contractId: string;
  contractName: string;
  downloaded: string[];
  notDownloaded: string[];
};

let downloadHistory:DownloadEvent[] = [];

try {
   downloadHistory = JSON.parse(fs.readFileSync(logPath + 'downloadHistory.json', 'utf8'));
} catch(err) {
  if (err.code === 'ENOENT') {
    console.log('downloadHistory.jsonを作成');
  } else {
    errorLogger.error(err);
  }
}

const getPDFs = async (browser:Browser): Promise<string> => {
  process.on('unhandledRejection', (reason, promise) => {
    errorLogger.error(reason);
  });
  
  const page = (await browser.pages())[0];
  await page.setUserAgent('bot');
  // console.logデバッグしたいときに
  page.on('console', msg => console.log(msg.text()));

  const res = await page.goto(topPage, {waitUntil: "domcontentloaded"});
  if (!res.ok()) {
    errorLogger.error('入札情報公開サービスに接続できませんでした');
    return
  }

  const cdpSession = await page.target().createCDPSession();


  let fileName:string = '';
  const downloadsInProgress:Set<string> = new Set();

  cdpSession.on('Browser.downloadWillBegin', ({ guid, suggestedFilename }) => {
    fileName = suggestedFilename;
    // console.log('download beginning,', fileName);
    downloadsInProgress.add(guid);
  });

  cdpSession.on('Browser.downloadProgress', ({ guid, state }) => {
    if (state === 'inProgress') {
      //console.log('download inProgress: ', guid);
      clearTimeout(downloadCompletionTimer) // inProgress中はダウンロード完了タイマーを消す
    }
    if (state === 'completed') {
      console.log('download completed: ', fileName);
      downloadsInProgress.delete(guid);
    }
  });

  let downloadCompletionTimer:NodeJS.Timeout;
  const downloadProgress = new Promise<void>((resolve, reject) => {
    cdpSession.on(
      "Browser.downloadProgress",
      (params: { state: "inProgress" | "completed" | "canceled" }) => {
        if (downloadsInProgress.size === 0) {
          downloadCompletionTimer = setTimeout(() => {
            clearTimeout(downloadFailedTimer); // ダウンロードタイムアウトタイマーを消す
            resolve();
          }, 10000);
        }
        if (params.state == "canceled") {
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

  // 発注情報検索: 業務名を入力して絞る
  await frame.type('[name="koujimei"]', projectTitle);

  // 発注情報検索: 検索ボタンをクリック
  await Promise.all([
    frame.waitForNavigation(),
    frame.click('[onclick="doSearch1();"]')
  ]);


  // 発注情報検索: 業務情報を取得
  let elementHandle = await frame.$('#frmMain');
  let frame2 = await elementHandle.contentFrame();

  type Contract = {
    contractId: string;
    contractName: string;
    linkArg: string;
    releaseDate: string;
  }

  let downloadContracts:Contract[] = await frame2.evaluate(() => {
    const trs = document.querySelectorAll('tr');
    const contracts:Contract[] = [];
    for (let i=0; i < trs.length; i++) {
      const tr = trs[i];
      if(tr.children[0].firstElementChild && tr.children[0].firstElementChild.tagName === 'IMG') {
        // 公開日に画像(New)があるとき
        const releaseDate:string = tr.children[0].textContent.replace(/\s/g, '');
        const contractName:string = tr.children[1].textContent.replace(/\s/g, '');
        const contractId:string = tr.children[2].textContent.replace(/\s/g, '');
        const linkArg:string = tr.children[1].firstElementChild.getAttribute('href');
        const contract:Contract = {
          contractId,
          contractName,
          linkArg,
          releaseDate
        }
        contracts.push(contract);
      }
    }
    return contracts
  });

  const downloadedIdList = downloadHistory.map(contract => contract.contractId);

  // ダウンロードプロジェクトリストからダウンロード済みのプロジェクトを除外
  downloadContracts = downloadContracts.filter(contract => !downloadedIdList.includes(contract.contractId));
  //console.log(downloadContracts);


  if (!downloadContracts.length) {
    // ダウンロードするものがない場合は終了
    systemLogger.info('新規ダウンロードなし');
    return; 
  }

  for (let i=0; i<downloadContracts.length; i++) {
    // 業務名クリック → 発注情報閲覧へ移動
    console.log('project: ' + downloadContracts[i].contractName);
    elementHandle = await frame.$('#frmMain');
    frame2 = await elementHandle.contentFrame();
    await Promise.all([
      frame.waitForNavigation(),
      frame2.click(`a[href="${downloadContracts[i].linkArg}"]`)
    ]);

    const contractId = downloadContracts[i].contractId;
    const contractName = downloadContracts[i].contractName;
    const folderName:string = contractId + '_' + contractName;
    
    // ダウンロード先の設定
    const downloadPath = `${executionPath}/data/${folderName}/`;
    await cdpSession.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath,
      eventsEnabled: true,
    });

    type downloadPdf = {
      fileName: string;
      href: string;
      enableDownload: boolean;
    }

    const downloadPdfs:downloadPdf[] = await frame.evaluate(async (btnSelector:string, pdfKeywords:string[]) => {
      // this executes in the page

      const links:NodeListOf<Element> = document.querySelectorAll(btnSelector);
      //const downloaded:string[] = [];
      //const notDownloaded:string[] = [];
      

      const downloadPdfs:downloadPdf[] = Array.from(links)
        .filter(link => link.textContent.replace(/\s/g, '') !== '') // 空行除太郎
        .map(link => {
          const fileName:string = link.textContent
            .replace(/[\r\n|\n|\r]/g, '') // 改行を削除
            .replace(/^\s*?(\S.*\S)\s.*?$/, '$1')  // ファイル名前後の空白を削除
            .replace(/(?<=\S) (?=\S)/, '+');  // ファイル名内部の 半角スペース を + に変更
          const href:string = link.getAttribute('href');
          const enableDownload:boolean = (typeof pdfKeywords.find(keyword => fileName.match(keyword)) !== 'undefined');
          const downloadPdf:downloadPdf = {
            fileName,
            href,
            enableDownload
          }
          return downloadPdf
        });

      return downloadPdfs;
    }, 'a[href^="javascript:download"]', pdfKeywords);

    //console.log('downloadPdfs');
    //console.log(downloadPdfs);

    let downloaded:string[] = [];
    let notDownloaded:string[] = [];
    for (let i=0; i<downloadPdfs.length; i++) {
      const downloadPdf = downloadPdfs[i];
      if (downloadPdf.enableDownload){
        // キーワードが含まれるPDFはダウンロードする
        const selector:string = `a[href="${downloadPdf.href}"]`;
        await Promise.all([
          frame.waitForSelector(selector),
          frame.click(selector),
          downloaded.push(downloadPdf.fileName), // ダウンロード履歴にダウンロード対象として追加
          sleep(1000)
        ]);
      } else {
        // キーワードが含まれないPDFはダウンロードしない
        notDownloaded.push(downloadPdf.fileName) // ダウンロード履歴にダウンロード対象外として追加
      }
    }

    // ダウンロード履歴に追加
    downloadHistory.push({
      contractId,
      contractName,
      downloaded,
      notDownloaded
    });

    // 戻るをクリック → 発注情報検索画面に戻る
    await Promise.all([
      frame.waitForNavigation(),
      frame.click('input[value="戻る"]')
    ]);
  }

  fs.writeFileSync(logPath + 'downloadHistory.json', JSON.stringify(downloadHistory, null, 2));

  // ロギング
  downloadHistory.forEach(project => {
    project.downloaded.forEach(pdf=> systemLogger.info(`DL済: [${project.contractId}] ${project.contractName} ${pdf}`));
    project.notDownloaded.forEach(pdf=> systemLogger.info(`未DL: [${project.contractId}] ${project.contractName} ${pdf}`));
  })

  let downloadFailedTimer:NodeJS.Timeout;
  await Promise.race([
    downloadProgress,
    new Promise<boolean>((_resolve, reject) => {
      downloadFailedTimer = setTimeout(() => {
        reject("download timed out");
      }, 30000);
    }),
  ]);
};



(async () => {
  // ブラウザ立ち上げ
  let browser:Browser;
  try {
    if (fs.existsSync('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe')) {
      browser = await launch({
        headless: true,
        //slowMo: 50,
        executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
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
    } else {
      browser = await launch({
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
    }
  } catch (error) {
    errorLogger.error(error);
  }
  // ダウンロード実行
  try {
    await getPDFs(browser);
    downloadCheck(downloadHistory);
  } catch(error) {
    errorLogger.error(error);
    log4js.shutdown((err)=> {
      if (err) throw err;
      process.exit(1);
    });
  } finally {
    await browser.close();
  };
})();
