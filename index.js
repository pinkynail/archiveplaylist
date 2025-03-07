const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fsPromises = require("fs").promises;
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const app = express();

app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Google Drive setup (оставляем как есть)
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

let archiveFolderIdCache = null;
let playlists = [];
let playlistsFileId = null;
let initializingPromise = null;

// Функции Google Drive (оставляем без изменений)
async function loadPlaylistsFromDrive() {
  /* ... */
}
async function savePlaylistsToDrive() {
  /* ... */
}
async function initializeArchiveFolder() {
  /* ... */
}
async function getOrCreateFolder(folderName, parentId = null) {
  /* ... */
}
async function getFolders(parentId) {
  /* ... */
}

(async () => {
  await initializeArchiveFolder();
  await loadPlaylistsFromDrive();
  console.log("Инициализация завершена");
})();

app.get("/", async (req, res) => {
  try {
    const archiveFolderId = await initializeArchiveFolder();
    const folders = await getFolders(archiveFolderId);
    res.render("index", { folders });
  } catch (error) {
    console.error("Ошибка в GET /:", error);
    res.send(`Ошибка: ${error.message}`);
  }
});

app.post("/download", async (req, res) => {
  const youtubeUrl = req.body.youtube_url;
  const newFolderName = req.body.new_folder_name;
  let folderId = req.body.folder_id;

  try {
    const metadata = await youtubedl(youtubeUrl, {
      dumpSingleJson: true,
      cookies: "cookies.txt",
    });
    const title = metadata.title.replace(/[/\\?%*:|"<>]/g, "");
    const fileName = `${title}-${Date.now()}.mp3`;

    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: fileName,
      cookies: "cookies.txt",
    });
    console.log("Скачано:", youtubeUrl);

    await fsPromises.access(fileName);

    const archiveFolderId = await initializeArchiveFolder();
    if (!folderId && newFolderName) {
      folderId = await getOrCreateFolder(newFolderName, archiveFolderId);
    } else if (!folderId) {
      folderId = await getOrCreateFolder("playlist", archiveFolderId);
    }

    const fileMetadata = { name: fileName, parents: [folderId] };
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

    const playlist = playlists.find((p) => p.id === folderId);
    if (playlist) {
      playlist.songs.push({ title, driveId: driveResponse.data.id });
      await savePlaylistsToDrive();
      console.log(`Добавлена песня "${title}" в плейлист "${playlist.name}"`);
    }

    await fsPromises.unlink(fileName);

    const folders = await getFolders(archiveFolderId);
    res.render("success", { title, driveId: driveResponse.data.id, folders });
  } catch (error) {
    console.error("Ошибка в POST /download:", error);
    res.send(`Ошибка: ${error.message}`);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
