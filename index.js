const { Configuration, OpenAIApi } = require("openai");
const { Client } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const ffmpeg = require("fluent-ffmpeg");
const FormData = require("form-data");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

require("dotenv").config();

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);

const client = new Client();

const CHAT_JSON_FILE = "./chats.json";

function readChats() {
  const fileContent = fs.readFileSync(CHAT_JSON_FILE);
  return JSON.parse(fileContent);
}

function writeChats(chats) {
  const stringJSON = JSON.stringify(chats);
  fs.writeFileSync(CHAT_JSON_FILE, stringJSON, "utf-8");
}

function addConversationToChat(conversation) {
  const { id, message, response } = conversation;

  const chats = readChats();

  if (!chats.chats[id]) {
    chats.chats[id] = [];
  }

  chats.chats[id].push({ message, response });

  writeChats(chats);
}

function getCurrentDate() {
  const currentDate = new Date();
  return currentDate.toGMTString().split(" ").join("-");
}

function ensureDirectoryExists(path) {
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

async function callWhisperAPI(filePath) {
  const WHISPER_API = "https://api.openai.com/v1/audio/transcriptions";
  const form = new FormData();
  const absolutePath = path.resolve(filePath);
  form.append("model", "whisper-1");
  form.append("file", fs.createReadStream(absolutePath));

  try {
    const response = await axios.post(WHISPER_API, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    return response.data.text;
  } catch (error) {
    console.log(error);
    return path;
  }
}

function convertOggToMp3(path) {
  return new Promise((resolve, reject) => {
    const output = path.replace("ogg", "mp3");
    ffmpeg(path)
      .inputFormat("ogg")
      .format("mp3")
      .save(output)
      .on("end", () => resolve(output))
      .on("error", (err) => reject(err));
  });
}

async function handleAudioFiles(directoryPath, mediaMimeType, decodedData) {
  ensureDirectoryExists(directoryPath);

  const oggFilePath = path.join(
    directoryPath,
    `${getCurrentDate()}.${mediaMimeType}`
  );

  let contentFilePath = oggFilePath;

  fs.writeFileSync(oggFilePath, decodedData, (err) => {
    if (err) {
      console.log(err);
    } else {
      console.log("File saved successfully");
    }
  });

  try {
    contentFilePath = await convertOggToMp3(oggFilePath);
    console.log({ handle: contentFilePath });
  } catch (error) {
    console.log({ handle: error });
  }

  return contentFilePath;
}

// function to call chatgpt
async function callChatGPT(prompt) {
  const response = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
  });

  return response.data.choices[0].message.content.trim();
}

// When client reads qr event, generate qr code in terminal
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
});

// When client is ready to use, log it
client.on("ready", () => {
  console.log("client is ready!");
});

// For every message received
client.on("message", async (message) => {
  const conversation = { id: message.from };
  if (!message.hasMedia && !message.isStatus) {
    let res;
    const { body } = message;

    // Assign message key with content and sent date to current conversation
    conversation["message"] = {
      content: body,
      sentDate: getCurrentDate(),
    };

    try {
      // Get response from chatgpt and reply to message
      res = await callChatGPT(body);
      message.reply(res);
    } catch (e) {
      res = "Something went wrong";
      message.reply(res);
    }

    // Create response conversation key
    conversation["response"] = {
      content: res,
      sentDate: getCurrentDate(),
    };

    // Add current message/response conversation to chat
    addConversationToChat(conversation);
    //
  } else if (message.hasMedia && !message.isStatus) {
    const directoryPath = `./${message.from}`;
    const media = await message.downloadMedia();
    const decodedData = Buffer.from(media.data, "base64");
    let mediaMimeType = media.mimetype.split("/")[1];

    if (mediaMimeType.includes("ogg")) {
      let audioRes = "";

      mediaMimeType = "ogg";

      let contentFile = await handleAudioFiles(
        directoryPath,
        mediaMimeType,
        decodedData
      );

      try {
        contentFile = await callWhisperAPI(contentFile);
      } catch (error) {
        console.log(err);
      }

      conversation["message"] = {
        content: contentFile,
        sentDate: getCurrentDate(),
      };

      try {
        audioRes = await callChatGPT(contentFile);
        console.log(audioRes);
        message.reply(audioRes);
      } catch (error) {
        console.log(error);
      }

      conversation["response"] = {
        content: audioRes,
        sentDate: getCurrentDate(),
      };

      addConversationToChat(conversation);
      fs.unlink(directoryPath, (err) => {
        if (err) {
          console.log(err);
        } else {
          console.log("done");
        }
      });
    }
  }
});

client.initialize();
