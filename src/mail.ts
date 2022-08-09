import * as nodemailer from "nodemailer"
import { systemLogger, errorLogger } from "./logger";;
import {config} from "./config";

const user:string = config.mail.user;
const pass:string = config.mail.pass;
const to:string = config.mail.to;

const transporter = nodemailer.createTransport({
  service: "gmail",
  port: 465,
  secure: true,
  auth: {
    user,
    pass,
  },
});

export const sendGmail = async (subject: string, text:string) => {
  transporter.sendMail({
    from: user,
    to,
    subject,
    text,
  }, function (error, info) {
    if (error) {
      errorLogger.error(error);
    } else {
      systemLogger.info(`Email sent: ${info.response}`);
    }
  });
}