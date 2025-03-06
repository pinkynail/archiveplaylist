const express = require("express");
const youtubedl = require("youtube-dl-exec");
const fsPromises = require("fs").promises;
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

let archiveFolderIdCache = null;
let playlists = [];
const PLAYLISTS_FILE = "playlists.json";

async function loadPlaylistsFromFile() {
  try {
    const data = await fsPromises.readFile(PLAYLISTS_FILE, "utf8");
    playlists = JSON.parse(data);
    console.log("Загружены плейлисты из файла:", playlists);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("Файл playlists.json не найден, начинаем с пустого списка");
      playlists = [];
    } else {
      console.error("Ошибка при загрузке плейлистов:", error);
      playlists = [];
    }
  }
}

async function savePlaylistsToFile() {
  try {
    await fsPromises.writeFile(
      PLAYLISTS_FILE,
      JSON.stringify(playlists, null, 2),
    );
    console.log("Плейлисты сохранены в файл:", playlists);
  } catch (error) {
    console.error("Ошибка при сохранении плейлистов:", error);
  }
}

async function initializeArchiveFolder() {
  try {
    // Ищем существующую папку ArchiveYoutubePlaylist
    const response = await drive.files.list({
      q: "'ArchiveYoutubePlaylist' mimeType='application/vnd.google-apps.folder'",
      fields: "files(id)",
      spaces: "drive",
    });
    const folders = response.data.files;
    if (folders && folders.length > 0) {
      archiveFolderIdCache = folders[0].id;
      console.log(
        "Найдена существующая ArchiveYoutubePlaylist с ID:",
        archiveFolderIdCache,
      );
    } else {
      archiveFolderIdCache = await getOrCreateFolder("ArchiveYoutubePlaylist");
    }

    // Синхронизация плейлистов
    if (playlists.length > 0) {
      const validPlaylists = playlists.filter(
        (p) => p.parentId === archiveFolderIdCache,
      );
      if (validPlaylists.length !== playlists.length) {
        playlists = validPlaylists;
        await savePlaylistsToFile();
        console.log(
          "Синхронизированы плейлисты с текущим ArchiveYoutubePlaylist",
        );
      }
    }
  } catch (error) {
    console.error(
      "Ошибка при инициализации ArchiveYoutubePlaylist:",
      error.message,
    );
    archiveFolderIdCache = await getOrCreateFolder("ArchiveYoutubePlaylist");
  }
}

async function getOrCreateFolder(folderName, parentId = null) {
  try {
    if (
      folderName === "ArchiveYoutubePlaylist" &&
      archiveFolderIdCache &&
      !parentId
    ) {
      return archiveFolderIdCache;
    }

    if (parentId) {
      const existingPlaylist = playlists.find(
        (p) => p.name === folderName && p.parentId === parentId,
      );
      if (existingPlaylist) {
        console.log(
          `Используем существующий плейлист "${folderName}" с ID:`,
          existingPlaylist.id,
        );
        return existingPlaylist.id;
      }
    }

    const folderMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: "id",
    });
    const folderId = folder.data.id;
    console.log(
      `Создана папка "${folderName}" с ID: ${folderId}${parentId ? ` (внутри ${parentId})` : ""}`,
    );

    if (folderName === "ArchiveYoutubePlaylist" && !parentId) {
      archiveFolderIdCache = folderId;
    } else if (parentId) {
      const newPlaylist = {
        id: folderId,
        name: folderName,
        parentId,
        songs: [],
      };
      playlists.push(newPlaylist);
      await savePlaylistsToFile();
    }

    return folderId;
  } catch (error) {
    console.error(`Ошибка при создании папки "${folderName}":`, error);
    throw error;
  }
}

async function getFolders(parentId) {
  const folders = playlists.filter((p) => p.parentId === parentId);
  console.log(`Плейлисты из памяти для ${parentId}:`, folders);
  return folders;
}

loadPlaylistsFromFile()
  .then(initializeArchiveFolder)
  .then(() => console.log("Инициализация завершена"));

app.get("/", async (req, res) => {
  try {
    const archiveFolderId =
      archiveFolderIdCache ||
      (await getOrCreateFolder("ArchiveYoutubePlaylist"));
    const folders = await getFolders(archiveFolderId);
    let folderOptions = folders
      .map((f) => `<option value="${f.id}">${f.name}</option>`)
      .join("");
    let playlistList = folders
      .map((f) => `<li>${f.name} (${f.songs.length} песен)</li>`)
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
      <h2>Существующие плейлисты:</h2>
      <ul>${playlistList || "<li>Плейлистов пока нет</li>"}</ul>
    `);
  } catch (error) {
    res.send(`Ошибка при загрузке страницы: ${error.message}`);
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

    const archiveFolderId =
      archiveFolderIdCache ||
      (await getOrCreateFolder("ArchiveYoutubePlaylist"));
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
      await savePlaylistsToFile();
      console.log(`Добавлена песня "${title}" в плейлист "${playlist.name}"`);
    }

    await fsPromises.unlink(fileName);

    const folders = await getFolders(archiveFolderId);
    let folderOptions = folders
      .map((f) => `<option value="${f.id}">${f.name}</option>`)
      .join("");
    let playlistList = folders
      .map((f) => `<li>${f.name} (${f.songs.length} песен)</li>`)
      .join("");

    res.send(`
      <h1>Archive Playlist</h1>
      <p>Аудио "${title}" скачано и загружено на Google Drive (ID: ${driveResponse.data.id})</p>
      <form method="POST" action="/download">
        <input type="text" name="youtube_url" placeholder="Вставь ссылку на YouTube" required><br>
        <label>Выбери плейлист:</label><br>
        <select name="folder_id">
          <option value="">Создать новый плейлист</option>
          ${folderOptions}
        </select><br>
        <input type="text" name="new_folder_name" placeholder="Имя нового плейлиста (если выбран 'Создать')"><br>
        <button type="submit">Сохранить ещё</button>
      </form>
      <h2>Существующие плейлисты:</h2>
      <ul>${playlistList || "<li>Плейлистов пока нет</li>"}</ul>
      <p><a href="/">Вернуться на главную</a></p>
    `);
  } catch (error) {
    console.error("Ошибка:", error);
    res.send(`
      <h1>Archive Playlist</h1>
      <p>Ошибка: ${error.message}</p>
      <p><a href="/">Вернуться на главную</a></p>
    `);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
