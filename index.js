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

// Кэш для ID корневой папки
let archiveFolderIdCache = null;
// Массив для хранения созданных плейлистов
let playlists = [];

async function getOrCreateFolder(folderName, parentId = null) {
  try {
    // Если это корневая папка ArchiveYoutubePlaylist и ID уже есть в кэше
    if (
      folderName === "ArchiveYoutubePlaylist" &&
      archiveFolderIdCache &&
      !parentId
    ) {
      console.log(
        "Используем кэшированный ID для ArchiveYoutubePlaylist:",
        archiveFolderIdCache,
      );
      return archiveFolderIdCache;
    }

    // Проверяем, существует ли папка с таким именем в памяти (только для плейлистов)
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

    // Создаём папку
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

    // Кэшируем ID для ArchiveYoutubePlaylist
    if (folderName === "ArchiveYoutubePlaylist" && !parentId) {
      archiveFolderIdCache = folderId;
    }

    // Добавляем плейлист в массив, если это не корневая папка
    if (parentId) {
      playlists.push({ id: folderId, name: folderName, parentId });
      console.log(`Добавлен плейлист в память:`, {
        id: folderId,
        name: folderName,
        parentId,
      });
    }

    return folderId;
  } catch (error) {
    console.error(`Ошибка при создании папки "${folderName}":`, error);
    throw error;
  }
}

async function getFolders(parentId) {
  // Возвращаем плейлисты из памяти, отфильтрованные по parentId
  const folders = playlists.filter((p) => p.parentId === parentId);
  console.log(`Плейлисты из памяти для ${parentId}:`, folders);
  return folders;
}

app.get("/", async (req, res) => {
  try {
    const archiveFolderId = await getOrCreateFolder("ArchiveYoutubePlaylist");
    const folders = await getFolders(archiveFolderId);
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
    const title = metadata.title.replace(/[/\\?%*:|"<>]/g, ""); // Убираем недопустимые символы
    const fileName = `${title}-${Date.now()}.mp3`; // Заголовок + метка времени

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

    const archiveFolderId = await getOrCreateFolder("ArchiveYoutubePlaylist");
    if (!folderId && newFolderName) {
      folderId = await getOrCreateFolder(newFolderName, archiveFolderId);
    } else if (!folderId) {
      folderId = await getOrCreateFolder("playlist", archiveFolderId);
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
      `Аудио "${title}" скачано и загружено на Google Drive (ID: ${driveResponse.data.id})`,
    );
  } catch (error) {
    console.error("Ошибка:", error);
    res.send(`Ошибка: ${error.message}`);
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
