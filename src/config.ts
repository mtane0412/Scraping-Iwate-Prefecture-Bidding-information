import * as path from 'path';
import * as fs from 'fs';
import * as toml from 'toml';
import { LaunchOptions, BrowserLaunchArgumentOptions, BrowserConnectOptions } from 'puppeteer';


// Puppeteerのlaunch オプション
const launchOptions:LaunchOptions & BrowserLaunchArgumentOptions & BrowserConnectOptions = {
  headless: true,
  //slowMo: 50,
  defaultViewport: {
    width: 1280,
    height: 882
  },
  args: [
    '--no-sandbox',
    '--disable-features=site-per-process'
  ]
}

// exeとnodeで実行パスを変える
const executionPath = path.resolve(process.pkg ?  path.dirname(process.execPath) : __dirname);

/*
  config
*/

type EmailConfig = {
  sendEmailEnabled:boolean|string;
  user:string;
  pass: string;
  to: string;
}

type DebugConfig = {
  debugEnabled: boolean;
  headless: boolean;
}

type Config = {
  chromePath?: string;
  topPage: string;
  pdfKeywords: string[];
  projectTitle: string;
  downloadOnlyNew: boolean|string;
  numberOfItems: 10|25|50|100;
  fileCheckEnabled: boolean|string;
  downloadTimeoutSec: number;
  pdfClickDelaySec: number;
  mail: EmailConfig;
  debug: DebugConfig;
}

let config:Config;
try {
  config = toml.parse(fs.readFileSync(path.join(executionPath, 'config.toml'), 'utf8'));
  
  // 設定を文字列で記述した場合にbool値に変換する
  if (typeof config.mail.sendEmailEnabled !== 'boolean') {
    config.mail.sendEmailEnabled = (config.mail.sendEmailEnabled.toLowerCase() === 'true');
  }

  if (typeof config.downloadOnlyNew !== 'boolean') {
    config.downloadOnlyNew = (config.downloadOnlyNew.toLowerCase() === 'true');
  }

  if (typeof config.fileCheckEnabled !== 'boolean') {
    config.fileCheckEnabled = (config.fileCheckEnabled.toLowerCase() === 'true');
  }

  // 表示件数の値が不正なときに100をセット
  const itemNumbers = [10, 25, 50, 100];
  if (!itemNumbers.includes(config.numberOfItems)) {
    console.log('表示件数の設定が不正です。10, 25, 50, 100のいずれかで数値を設定する必要があります');
    console.log('表示件数を100に設定しました');
    config.numberOfItems = 100; // 100を設定
  }
} catch (error) {
  console.log('config.tomlファイルなし、デフォルト設定をロード')
  config = {
    topPage: "https://www.epi-cloud.fwd.ne.jp/koukai/do/KF001ShowAction?name1=0620060006600600",
    pdfKeywords:  [
      "公告",
      "位置図",
      "図面",
      "参考資料",
      "平面図"
    ],
    projectTitle: "設計",
    downloadOnlyNew: true,
    numberOfItems: 100,
    fileCheckEnabled: false,
    downloadTimeoutSec: 30,
    pdfClickDelaySec: 3,
    mail : {
      sendEmailEnabled: false,
      user: "",
      pass: "",
      to: ""
    },
    debug : {
      debugEnabled: false,
      headless: true
    }
  }
}

export {launchOptions, executionPath, config}