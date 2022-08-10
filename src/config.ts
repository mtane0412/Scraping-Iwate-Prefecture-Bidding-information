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
const executionPath = path.join(process.pkg ? path.dirname(process.execPath) : process.cwd());

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
  pdfClickTimer: number;
}

type Config = {
  topPage: string;
  pdfKeywords: string[];
  projectTitle: string;
  downloadBufferSec: number;
  mail: EmailConfig;
  debug: DebugConfig;
}

let config:Config;
try {
  config = toml.parse(fs.readFileSync(executionPath + '/config.toml', 'utf8'));
  if (typeof config.mail.sendEmailEnabled !== 'boolean') {
    // 人が文字列で設定してしまった場合にbool値にする
    config.mail.sendEmailEnabled = (config.mail.sendEmailEnabled.toLowerCase() === 'true');
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
    downloadBufferSec: 30,
    mail : {
      sendEmailEnabled: false,
      user: "",
      pass: "",
      to: ""
    },
    debug : {
      debugEnabled: false,
      headless: true,
      pdfClickTimer: 3
    }
  }
}

export {launchOptions, executionPath, config}