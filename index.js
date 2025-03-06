const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs");
const { google } = require("googleapis");
const app = express();

app.use(express.urlencoded({ extended: true }));

// Настройка Google Drive API
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const credentials = require("./credentials.json");
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0],
);
oAuth2Client.setCredentials({
  refresh_token:
    "1//0cdju2Uso9dYRCgYIARAAGAwSNwF-L9IrGavF7m-YwZsucjZQO7x6o3FRQVZgQMMgJ3HN0lDgTOfPqhAN4Yx8XUc46nR1yuxR9UQ",
});

const drive = google.drive({ version: "v3", auth: oAuth2Client });

app.get("/", (req, res) => {
  res.send(`
        <h1>Archive Playlist</h1>
        <form method="POST" action="/download">
            <input type="text" name="youtube_url" placeholder="Вставь ссылку на YouTube" required>
            <button type="submit">Сохранить</button>
        </form>
    `);
});

app.post("/download", async (req, res) => {
  const youtubeUrl = req.body.youtube_url;
  try {
    // Скачиваем аудио
    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: "song.mp3",
      cookies: "cookies.txt",
    });
    console.log("Скачано:", youtubeUrl);

    // Проверяем файл
    if (!fs.existsSync("song.mp3")) {
      throw new Error("Файл не найден после скачивания");
    }

    // Загружаем на Google Drive
    const fileMetadata = { name: "song.mp3" };
    const media = {
      mimeType: "audio/mp3",
      body: fs.createReadStream("song.mp3"),
    };
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });
    console.log("Загружено на Drive, ID:", driveResponse.data.id);

    res.send(
      `Аудио скачано из: ${youtubeUrl} и загружено на Google Drive (ID: ${driveResponse.data.id})`,
    );
  } catch (error) {
    console.error("Ошибка:", error);
    res.send(`Ошибка: ${error.message}`);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
