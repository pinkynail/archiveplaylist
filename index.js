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

async function getOrCreateFolder(folderName) {
  const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q: query, fields: "files(id)" });
  const folders = res.data.files;

  if (folders && folders.length > 0) {
    return folders[0].id;
  }

  const folderMetadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  const folder = await drive.files.create({
    resource: folderMetadata,
    fields: "id",
  });
  return folder.data.id;
}

async function getFolders() {
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: "files(id, name)",
  });
  return res.data.files || [];
}

app.get("/", async (req, res) => {
  const folders = await getFolders();
  let folderOptions = folders
    .map((f) => `<option value="${f.id}">${f.name}</option>`)
    .join("");
  res.send(`
        <h1>Archive Playlist</h1>
        <form method="POST" action="/download">
            <input type="text" name="youtube_url" placeholder="Вставь ссылку на YouTube" required><br>
            <label>Выбери плейлист:</label><br>
            <select name="folder_id">
                <option value="">Создать новый плейлист</option>
                ${folderOptions}
            </select><br>
            <input type="text" name="new_folder_name" placeholder="Имя нового плейлиста (если выбран 'Создать')"><br>
            <button type="submit">Сохранить</button>
        </form>
    `);
});

app.post("/download", async (req, res) => {
  const youtubeUrl = req.body.youtube_url;
  const videoId = youtubeUrl.split("v=")[1]?.split("&")[0] || "unknown";
  const fileName = `${videoId}-${Date.now()}.mp3`;
  let folderId = req.body.folder_id;
  const newFolderName = req.body.new_folder_name;

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

    // Если выбран "Создать новый" и указано имя, создаём папку
    if (!folderId && newFolderName) {
      folderId = await getOrCreateFolder(newFolderName);
    } else if (!folderId) {
      folderId = await getOrCreateFolder("playlist"); // По умолчанию
    }

    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };
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
