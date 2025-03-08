const express = require("express");
const app = express();

app.get("/", (req, res) => {
  console.log("GET /: Sending Hello World");
  res.send("Hello World");
});

app.get("/ready", (req, res) => {
  console.log("Ready check requested");
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
