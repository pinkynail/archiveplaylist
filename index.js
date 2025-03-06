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

async function getOrCreateFolder(folderName, parentId = null) {
  // Формируем строку поиска: точное имя и тип папки
  const query = `"${folderName}" mimeType:application/vnd.google-apps.folder`;

  // Параметры запроса
  const params = {
    q: query,
    fields: "files(id)",
    spaces: "drive", // Ограничиваем поиск только Google Drive (не корзина)
  };

  if (parentId) {
    params.q += ` ${parentId} in:parents`;
  }

  try {
    console.log("Поиск папки с параметрами:", params); // Отладка
    const res = await drive.files.list(params);
    console.log("Результат поиска:", res.data); // Отладка
    const folders = res.data.files;

    if (folders && folders.length > 0) {
      return folders[0].id;
    }

    // Если папка не найдена, создаём её
    const folderMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: "id",
    });
    console.log("Создана папка с ID:", folder.data.id); // Отладка
    return folder.data.id;
  } catch (error) {
    console.error("Ошибка в getOrCreateFolder:", error);
    throw error;
  }
}

async function getFolders(parentId) {
  const query = `${parentId} in:parents mimeType:application/vnd.google-apps.folder`;
  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive", // Ограничиваем поиск только Google Drive
  });
  console.log("Найденные папки:", res.data.files); // Отладка
  return res.data.files || [];
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
    const title = metadata.title.replace(/[/\\?%*:|"<>]/g, "");
    const fileName = `${title}-${Date.now()}.mp3`;

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
