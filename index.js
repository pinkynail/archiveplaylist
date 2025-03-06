const express = require('express');
const app = express();

// Настраиваем парсинг данных из формы
app.use(express.urlencoded({ extended: true }));

// Главная страница с формой
app.get('/', (req, res) => {
    res.send(`
        <h1>Archive Playlist</h1>
        <form method="POST" action="/download">
            <input type="text" name="youtube_url" placeholder="Вставь ссылку на YouTube" required>
            <button type="submit">Сохранить</button>
        </form>
    `);
});

// Обработка POST-запроса
app.post('/download', (req, res) => {
    const youtubeUrl = req.body.youtube_url;
    console.log('Получена ссылка:', youtubeUrl);
    res.send(`Ссылка принята: ${youtubeUrl}`);
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
