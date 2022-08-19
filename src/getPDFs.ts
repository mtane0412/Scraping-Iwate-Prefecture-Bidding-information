import { Browser, launch } from 'puppeteer';
import * as path from 'path';
import * as fs from 'fs';
import { launchOptions, executionPath, config } from './config';
import {systemLogger, errorLogger} from './logger';
import { sendGmail } from './mail';

const topPage:string = config.topPage; // 岩手県入札情報公開トップページ
const pdfKeywords:string[] = config.pdfKeywords; // このキーワードを含むPDFをダウンロードする
const projectTitle:string = config.projectTitle; // この業務名を含むものに絞る
let downloadBuffer:number = config.downloadTimeoutSec * 1000;
if (downloadBuffer < 10000) {
  downloadBuffer = 10000;
  console.log('ダウンロード待ち時間が短すぎます。10秒に設定しました。');
}
console.log('業務名「' + projectTitle + '」を含む案件から、「' + pdfKeywords.join(', ') + '」をタイトルに含むPDFをダウンロードします');

// sleep関数
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// PDFダウンロードチェック関数
const downloadCheck = async (downloadHistory: DownloadEvent[]) => {
  // ダウンロード履歴を参照して存在していないファイルがあるプロジェクトのリストを返す
  type failedDownload = {
    contractId: string;
    contractName: string;
    fileName: string;
  }
  const failedDownloads:failedDownload[] = [];
  let failedDownloadsText:string = '';
  downloadHistory.forEach(contract=> {
    const contractId:string = contract.contractId;
    const contractName:string = contract.contractName;
    const folderName:string = contractId + '_' + contractName;
    const downloadPath:string = path.join(executionPath, `data/${folderName}/`);
    for (let i=0;i<contract.downloaded.length; i++) {
      const fileName = contract.downloaded[i];
      const pdfPath = downloadPath + fileName;
      const pdfExists:boolean = fs.existsSync(pdfPath);
      if (!pdfExists) {
        console.log('not exist:' + pdfPath);
        failedDownloads.push({contractId, contractName, fileName});
        failedDownloadsText += `${contractName}(${contractId}) - ${fileName}\n`;
      }
    }
  })
  //console.table(failedDownloads);
  if (failedDownloads.length === 0) {
    console.log('ダウンロードが正常に終了しました。')
  } else {
    console.log('以下のファイルがダウンロードに失敗した可能性があります。')
    console.table(failedDownloads);
    text += '以下のファイルがダウンロードに失敗した可能性があります。\n'
    text += failedDownloadsText;
  };
  return failedDownloads
}

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
   downloadHistory = JSON.parse(fs.readFileSync(path.join(executionPath, 'downloadHistory.json'), 'utf8'));
} catch(err) {
  if (err.code === 'ENOENT') {
    console.log('downloadHistory.jsonを作成');
  } else {
    errorLogger.error(err);
  }
}

/*
  メール送信設定
*/

const today:string = new Date().toLocaleDateString(); // 今日の日付
const subject:string = `岩手県入札情報DL結果(${today})`;
let text:string = "";

/*
  ダウンローダー本体
*/

const getPDFs = async (browser:Browser): Promise<string> => {
  process.on('unhandledRejection', (reason, promise) => {
    errorLogger.error(reason);
  });
  
  const page = (await browser.pages())[0];
  await page.setUserAgent('bot');
  page.setDefaultTimeout(90000); // 遷移のタイムアウトを90秒に変更
  // console.logデバッグしたいときに
  // page.on('console', msg => console.log(msg.text()));

  const res = await page.goto(topPage, {waitUntil: "domcontentloaded"});
  if (!res.ok()) {
    errorLogger.error('入札情報公開サービスに接続できませんでした');
    return
  }

  const cdpSession = await page.target().createCDPSession();

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
      //if(requestType === 'document' && requestMethod === 'POST') console.log(requestUrl);
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
  let numberOfItemsValue: '010'|'020'|'030'|'040';
  switch(config.numberOfItems) {
    case 10:
      numberOfItemsValue = '010';
    case 25:
      numberOfItemsValue = '020';
    case 50:
      numberOfItemsValue = '030';
    case 100:
    default:
      numberOfItemsValue = '040';
  }
  await frame.select('select[name="A300"]', numberOfItemsValue);
  console.log('案件表示件数:', config.numberOfItems);
  console.log('案件ごとのダウンロードタイムアウト時間:', config.downloadTimeoutSec, '秒');
  console.log('各PDFクリックディレイ:', config.pdfClickDelaySec, '秒');

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
    isNew: boolean;
  }

  let downloadContracts:Contract[] = await frame2.evaluate(() => {
    const trs = document.querySelectorAll('tr');
    const contracts:Contract[] = [];
    for (let i=0; i < trs.length; i++) {
      const tr = trs[i];
      const releaseDate:string = tr.children[0].textContent.replace(/\s/g, '');
      const contractName:string = tr.children[1].textContent.replace(/\s/g, '');
      const contractId:string = tr.children[2].textContent.replace(/\s/g, '');
      const linkArg:string = tr.children[1].firstElementChild.getAttribute('href');
      const isNew:boolean = tr.children[0].firstElementChild && tr.children[0].firstElementChild.tagName === 'IMG'; // 公開日に画像(New)があるものはNew
      const contract:Contract = {
        contractId,
        contractName,
        linkArg,
        releaseDate,
        isNew
      }
      contracts.push(contract);
    }
    return contracts
  });

  const downloadedIdList = downloadHistory.map(contract => contract.contractId);

  console.log('Newのみをダウンロード: ' , config.downloadOnlyNew);
  // NewのみをダウンロードするときはNew以外を除外
  if (config.downloadOnlyNew) {
    downloadContracts = downloadContracts.filter(contract => contract.isNew)
  }

  // ダウンロードプロジェクトリストからダウンロード済みのプロジェクトを除外
  downloadContracts = downloadContracts.filter(contract => !downloadedIdList.includes(contract.contractId));
  //console.log(downloadContracts);


  if (!downloadContracts.length) {
    // ダウンロードするものがない場合は終了
    systemLogger.info('新規ダウンロードなし');
    text += "新規ダウンロードはありませんでした\n\n" // メール本文
    return; 
  }

  text += `${today}のダウンロード結果\n\n`; // メール本文

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
    const downloadPath = path.join(executionPath, `data/${folderName}/`);
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
      const links:NodeListOf<Element> = document.querySelectorAll(btnSelector);
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


    const downloadList:Map<string, string> = new Map();

    cdpSession.on('Browser.downloadWillBegin', ({ guid, suggestedFilename }) => {
      console.log('download beginning:', suggestedFilename);
      downloadList.set(guid, suggestedFilename);
    });

    const downloadNum = downloadPdfs.filter(downloadPdf => downloadPdf.enableDownload === true).length;
    let downloadedNum = 0;
    let downloadFailedTimer:NodeJS.Timeout;
    let downloaded:string[] = [];
    let notDownloaded:string[] = [];

    const downloadProgress = new Promise<void>((resolve, reject) => {
      
      // ダウンロードするPDFが0のときは次へ
      if (downloadNum === 0) {
        console.log('ダウンロードするPDFがありません');
        resolve();
      }

      cdpSession.on(
        "Browser.downloadProgress",
        async ({guid, state}) => {
          //console.log(guid, state);
          if (state === 'inProgress') {
            //console.log('downloading: ', downloadList.get(guid));
            //console.log(downloadedNum + ' / ' + downloadNum);
          }
          if (state === 'completed') {
            console.log('download completed: ', downloadList.get(guid));
            downloaded.push(downloadList.get(guid)); // ダウンロード履歴にダウンロード対象として追加
            downloadedNum += 1;
            //console.log(downloadedNum + ' / ' + downloadNum);
          }
          if (downloadedNum === downloadNum) {
            console.log(contractName + ': ダウンロード完了');
            clearTimeout(downloadFailedTimer); // ダウンロードタイムアウトタイマーを消す
            //console.log(downloadedNum + ' / ' + downloadNum);
            resolve();
          }
          if (state == "canceled") {
            reject("download cancelled");
          }
        }
      );
    });

    for (let i=0; i<downloadPdfs.length; i++) {
      const downloadPdf = downloadPdfs[i];
      if (downloadPdf.enableDownload){
        // キーワードが含まれるPDFはダウンロードする
        const selector:string = `a[href="${downloadPdf.href}"]`;
        await frame.waitForSelector(selector);
        await frame.click(selector);
        if (config.pdfClickDelaySec > 0) {
          await sleep(config.pdfClickDelaySec * 1000);
        } else {
          await sleep(1000);
        }
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

    systemLogger.info(contractId, contractName, '\n  ダウンロード済ファイル\n    ・' + downloaded.join('\n    ・'), '\n  未ダウンロードファイル\n    ・' + notDownloaded.join('\n    ・'));

    // メール本文に結果を追記
    text +='**********************************************************************';
    text += `\n\n${contractName} (${contractId})\n`
    text += '【DL済】\n' + downloaded.map(x=>'・' + x).join('\n') + '\n';
    text += '【未DL】\n' + notDownloaded.map(x=>'・' + x).join('\n') + '\n';
    text += '\n\n'

    await Promise.race([
      downloadProgress,
      new Promise<boolean>((_resolve, reject) => {
        downloadFailedTimer = setTimeout(() => {
          reject("download timed out");
        }, downloadBuffer);
      }),
    ]);

    cdpSession.removeAllListeners("Browser.downloadWillBegin");
    cdpSession.removeAllListeners("Browser.downloadProgress");
    clearTimeout(downloadFailedTimer);
    // 戻るをクリック → 発注情報検索画面に戻る
    await Promise.all([
      frame.waitForNavigation(),
      frame.click('input[value="戻る"]')
    ]);
  }

  fs.writeFileSync(path.join(executionPath, 'downloadHistory.json'), JSON.stringify(downloadHistory, null, 2));
};



(async () => {
  // ブラウザ立ち上げ
  let browser:Browser;
  if (config.debug.debugEnabled && typeof config.debug.headless === 'boolean') {
    launchOptions.headless = config.debug.headless;
  }
  try {
    if (fs.existsSync(path.resolve('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'))) {
      // Win x86フォルダにインストールされている場合
      console.log('x86のChromeを使用');
      launchOptions.executablePath = path.resolve('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
      browser = await launch(launchOptions);
    } else if (config.chromePath) {
      console.log('次のChromeを使用: ', config.chromePath);
      launchOptions.executablePath = path.resolve(config.chromePath);
    } else {
      launchOptions.channel = 'chrome';
      browser = await launch(launchOptions);
    }
  } catch (error) {
    errorLogger.error(error);
  }
  // ダウンロード実行
  try {
    await getPDFs(browser);
    await downloadCheck(downloadHistory);
  } catch(error) {
    errorLogger.error(error);
    text+= '\n\n【エラー情報】\n'
    text+= error;
    /*
    log4js.shutdown((err)=> {
      if (err) throw err;
      process.exit(1);
    });
    */
  } finally {
    if(config.mail.sendEmailEnabled) {
      await sendGmail(subject, text);
    }
    await browser.close();
  };
})();
