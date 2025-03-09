require("dotenv").config();
const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fsPromises = require("fs").promises;
const fs = require("fs");
const { google } = require("googleapis");
const path = require("path");
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

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

async function initializeArchiveFolder() {
  if (archiveFolderIdCache) return archiveFolderIdCache;
  archiveFolderIdCache = "1opfVlshZHmomjtmdoFnffH7N-sTBAbEB";
  try {
    await drive.files.get({ fileId: archiveFolderIdCache });
    console.log("Folder verified");
  } catch (error) {
    console.error("Error verifying folder:", error.message);
    throw new Error("Указанный ID папки недоступен");
  }
  return archiveFolderIdCache;
}

async function loadPlaylistsFromDrive() {
  const playlistsFileId = "1mEd7LeS8aloGZTeBD01lbLVnhp4adIGs";
  try {
    if (!archiveFolderIdCache) await initializeArchiveFolder();
    const file = await drive.files.get({
      fileId: playlistsFileId,
      alt: "media",
    });
    playlists = file.data || [];
    console.log("Playlists loaded:", playlists);
  } catch (error) {
    console.error("Error loading playlists:", error.message);
    playlists = [];
  }
}

async function savePlaylistsToDrive() {
  const playlistsFileId = "1mEd7LeS8aloGZTeBD01lbLVnhp4adIGs";
  try {
    if (!archiveFolderIdCache) await initializeArchiveFolder();
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
      await drive.files.update({
        fileId: playlistsFileId,
        media,
        fields: "id",
      });
    } else {
      const newFile = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: "id",
      });
    }
  } catch (error) {
    console.error("Error saving playlists:", error.message);
  }
}

async function getOrCreateFolder(folderName, parentId = null) {
  try {
    if (
      folderName === "ArchiveYoutubePlaylist" &&
      archiveFolderIdCache &&
      !parentId
    )
      return archiveFolderIdCache;
    if (parentId) {
      const existingPlaylist = playlists.find(
        (p) => p.name === folderName && p.parentId === parentId,
      );
      if (existingPlaylist) return existingPlaylist.id;
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
    if (parentId) {
      const newPlaylist = {
        id: folderId,
        name: folderName,
        parentId,
        songs: [],
      };
      playlists.push(newPlaylist);
      await savePlaylistsToDrive();
    }
    return folderId;
  } catch (error) {
    throw error;
  }
}

async function getFolders(parentId) {
  try {
    return playlists.filter((p) => p.parentId === parentId) || [];
  } catch (error) {
    console.error("Error in getFolders:", error.message);
    return [];
  }
}

app.get("/", async (req, res) => {
  try {
    if (playlists.length === 0) await loadPlaylistsFromDrive();
    const archiveFolderId = await initializeArchiveFolder();
    const folders = (await getFolders(archiveFolderId)) || [];
    res.render("index", { folders });
  } catch (error) {
    res.status(500).send("Ошибка: " + error.message);
  }
});

app.post("/download", async (req, res) => {
  const youtubeUrl = req.body.youtube_url;
  const newFolderName = req.body.new_folder_name;
  let folderId = req.body.folder_id;

  try {
    console.log("Attempting to download from URL:", youtubeUrl);

    // Проверка, что cookies загружены
    if (!global.cookiesPath) {
      throw new Error("Cookies не загружены. Перезапустите приложение.");
    }

    const metadata = await youtubedl(youtubeUrl, {
      dumpSingleJson: true,
      cookies: global.cookiesPath,
      ffmpegLocation: process.env.FFMPEG_PATH,
    });
    const title = metadata.title.replace(/[/\\?%*:|"<>]/g, "");
    const fileName = `${title}-${Date.now()}.mp3`;

    await youtubedl(youtubeUrl, {
      extractAudio: true,
      audioFormat: "mp3",
      output: fileName,
      cookies: global.cookiesPath,
      ffmpegLocation: process.env.FFMPEG_PATH,
    });
    await fsPromises.access(fileName);

    const archiveFolderId = await initializeArchiveFolder();
    if (!folderId && newFolderName)
      folderId = await getOrCreateFolder(newFolderName, archiveFolderId);
    else if (!folderId)
      folderId = await getOrCreateFolder("playlist", archiveFolderId);

    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = {
      mimeType: "audio/mp3",
      body: fs.createReadStream(fileName),
    };
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: "id",
    });

    const playlist = playlists.find((p) => p.id === folderId);
    if (playlist) {
      playlist.songs.push({ title, driveId: driveResponse.data.id });
      await savePlaylistsToDrive();
    }

    await fsPromises.unlink(fileName);
    const folders = await getFolders(archiveFolderId);
    res.render("success", { title, driveId: driveResponse.data.id, folders });
  } catch (error) {
    console.error("Download error:", error.message);
    res.status(500).send("Ошибка: " + error.message);
  }
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Функция для загрузки cookies.txt из Google Drive
async function loadCookiesFromDrive() {
  try {
    const drive = google.drive({ version: "v3", auth });
    const fileId = "1HTewN8jUeX7BQeKlWbxkQ1kefwHvVI7o"; // ID файла из Google Drive
    const dest = "/tmp/cookies.txt";

    // Скачиваем файл
    const response = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" },
    );
    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(dest);
      response.data
        .on("end", () => {
          console.log("Cookies загружены в /tmp/cookies.txt");
          // Устанавливаем атрибут "только для чтения"
          fs.chmodSync(dest, 0o444); // Чтение только
          resolve();
        })
        .on("error", reject)
        .pipe(fileStream);
    });
    return dest;
  } catch (error) {
    console.error("Ошибка загрузки cookies из Google Drive:", error.message);
    throw new Error(
      "Не удалось загрузить cookies. Проверь подключение к Google Drive.",
    );
  }
}

// Инициализация при старте приложения
(async () => {
  try {
    // Загружаем cookies перед запуском сервера
    const cookiesPath = await loadCookiesFromDrive();
    global.cookiesPath = cookiesPath; // Делаем путь доступным глобально

    // Запуск сервера
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Ошибка при запуске:", error.message);
    process.exit(1);
  }
})();

const PORT = process.env.PORT || 3000; // Используем порт 3000, как договорились
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  loadPlaylistsFromDrive().catch(console.error);
});
