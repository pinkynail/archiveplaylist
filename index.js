const express = require(express);
const youtubedl = require(youtube-dl-exec);
const app = express();

app.use(express.urlencoded({ extended: true }));

app.get(/, (req, res) => {
    res.send(`
        <h1>Archive Playlist</h1>
        <form method="POST" action="/download">
            <input type="text" name="youtube_url" placeholder="Вставь ссылку на YouTube" required>
            <button type="submit">Сохранить</button>
        </form>
    `);
});

app.post(/download, async (req, res) => {
    const youtubeUrl = req.body.youtube_url;
    try {
        await youtubedl(youtubeUrl, {
            extractAudio: true,
            audioFormat: mp3,
            output: song.mp3
        });
        console.log(Скачано:, youtubeUrl);
        res.send(`Аудио скачано из: ${youtubeUrl}`);
    } catch (error) {
        console.error(Ошибка:, error);
        res.send(`Ошибка при скачивании: ${error.message}`);
    }
});

app.listen(3000, () => {
    console.log(Server running on port 3000);
});
