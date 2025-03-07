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

// Google Drive setup
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const credentials = {
  web: {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uris: [process.env.GOOGLE_REDIRECT_URI],
  },
};
const { client_secret, client_id, redirect_uris } = credentials.web;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: "v3", auth: oAuth2Client });

let archiveFolderIdCache = null;
let playlists = [];
let playlistsFileId = "1mEd7LeS8aloGZTeBD01lbLVnhp4adIGs"; // Жёстко заданный ID существующего playlists.json

async function initializeArchiveFolder() {
  if (archiveFolderIdCache) {
    console.log("ArchiveYoutubePlaylist уже инициализирована с ID:", archiveFolderIdCache);
    return archiveFolderIdCache;
  }

  archiveFolderIdCache = "1opfVlshZHmomjtmdoFnffH7N-sTBAbEB";
  console.log("Используем существующую ArchiveYoutubePlaylist с ID:", archiveFolderIdCache);

  try {
    await drive.files.get({ fileId: archiveFolderIdCache });
    console.log("Папка подтверждена:", archiveFolderIdCache);
  } catch (error) {
    console.error("Ошибка при проверке папки:", error.message);
    throw new Error("Указанный ID папки недоступен");
  }

  return archiveFolderIdCache;
}

async function loadPlaylistsFromDrive() {
  console.log("Попытка загрузить playlists.json с Google Drive...");
  try {
    if (!archiveFolderIdCache) {
      console.log("archiveFolderIdCache не установлен, инициализируем...");
      await initializeArchiveFolder();
    }
    console.log("Загрузка playlists.json с ID:", playlistsFileId);
    const file = await drive.files.get({ fileId: playlistsFileId, alt: "media" });
    playlists = file.data || [];
    console.log("Успешно загружены плейлисты из Google Drive:", playlists);
  } catch (error) {
    console.error("Ошибка при загрузке плейлистов:", error.message);
    console.log("Используем пустой массив из-за ошибки...");
    playlists = [];
  }
}

async function savePlaylistsToDrive() {
  console.log("Сохранение playlists.json на Google Drive...");
  try {
    if (!archiveFolderIdCache) {
      console.log("archiveFolderIdCache не установлен, инициализируем...");
      await initializeArchiveFolder();
    }
    const fileMetadata = {
      name: "playlists.json",
      mimeType: "application/json",
      parents: [archiveFolderIdCache],
    };
    const media = {
      mimeType: "application/json",
      body: JSON.stringify(playlists, null, 2),
    };

    if (playlistsFileId) {
      const updatedFile = await drive.files.update({
        fileId: playlistsFileId,
        media,
        fields: "id",
      });
      console.log("Обновлён playlists.json на Google Drive, ID:", updatedFile.data.id);
    } else {
      const newFile = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: "id",
      });
      playlistsFileId = newFile.data.id;
      console.log("Создан playlists.json на Google Drive, ID:", playlistsFileId);
    }
  } catch (error) {
    console.error("Ошибка при сохранении playlists.json:", error.message);
  }
}

async function getOrCreateFolder(folderName, parentId = null) {
  try {
    if (folderName === "ArchiveYoutubePlaylist" && archiveFolderIdCache && !parentId) {
      console.log("Используем кэшированный ID для ArchiveYoutubePlaylist:", archiveFolderIdCache);
      return archiveFolderIdCache;
    }

    if (parentId) {
      const existingPlaylist = playlists.find((p) => p.name === folderName && p.parentId === parentId);
      if (existingPlaylist) {
        console.log(`Используем существующий плейлист "${folderName}" с ID:`, existingPlaylist.id);
        return existingPlaylist.id;
      }
    }

    const folderMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : [archiveFolderIdCache],
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: "id",
    });
    const folderId = folder.data.id;
    console.log(`Создана папка "${folderName}" с ID: ${folderId}${parentId ? ` (внутри ${parentId})` : ""}`);

    if (parentId) {
      const newPlaylist = { id: folderId, name: folderName, parentId, songs: [] };
      playlists.push(newPlaylist);
      await savePlaylistsToDrive();
    }

    return folderId;
  } catch (error) {
    console.error(`Ошибка при создании папки "${folderName}":`, error.message);
    throw error;
  }
}

async function getFolders(parentId) {
  try {
    const folders = playlists.filter((p) => p.parentId === parentId);
    console.log(`Плейлисты из памяти для ${parentId}:`, folders);
    return folders || [];
  } catch (error) {
    console.error("Ошибка в getFolders:", error.message);
    return [];
  }
}

// Инициализация
(async () => {
  await initializeArchiveFolder();
  await loadPlaylistsFromDrive();
  console.log("Инициализация завершена");
})();

app.get("/", async (req, res) => {
  try {
    const archiveFolderId = await initializeArchiveFolder();
    const folders = await getFolders(archiveFolderId) || [];
    console.log("Folders for render:", folders);
    res.render("index", { folders });
  } catch (error) {
    console.error("Ошибка в GET /:", error.message);
    res.status(500).render("error", { message: error.message });
  }
});

app.post("/download", async (req, res) => {
  const youtubeUrl = req.body.youtube_url;
  const newFolderName = req.body.new_folder_name;
  let folderId = req.body.folder_id;

  try {
    const metadata = await youtubedl(youtubeUrl, { dumpSingleJson: true, cookies: "cookies.txt" });
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
    const media = { mimeType: "audio/mp3", body: fs.createReadStream(fileName) };
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
    console.error("Ошибка в POST /download:", error.message);
    res.status(500).render("error", { message: error.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
