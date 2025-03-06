const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fs = require("fs");
const { google } = require("googleapis");
const app = express();

app.use(express.urlencoded({ extended: true }));

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const credentials = {
  web: {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [process.env.GOOGLE_REDIRECT_URI],
  },
};
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0],
);
oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
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
  const videoId = youtubeUrl.split("v=")[1]?.split("&")[0] || "unknown"; // Извлекаем ID видео
  const fileName = `${videoId}-${Date.now()}.mp3`; // Уникальное имя с ID и датой

  try {
    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: fileName,
      cookies: "cookies.txt",
    });
    console.log("Скачано:", youtubeUrl);

    if (!fs.existsSync(fileName)) {
      throw new Error("Файл не найден после скачивания");
    }

    const fileMetadata = { name: fileName };
    const media = {
      mimeType: "audio/mp3",
      body: fs.createReadStream(fileName),
    };
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });
    console.log("Загружено на Drive, ID:", driveResponse.data.id);

    // Удаляем временный файл
    fs.unlinkSync(fileName);

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
