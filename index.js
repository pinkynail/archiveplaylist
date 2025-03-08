app.get("/protect", async (req, res) => {
  console.log("GET /protect: Sending protect page");
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Protect</title>
    </head>
    <body>
      <h1>Enter Code</h1>
      <form method="POST" action="/protect">
        <input type="text" name="code" placeholder="Enter code" />
        <button type="submit">Submit</button>
      </form>
    </body>
    </html>
  `);
});

app.post("/protect", async (req, res) => {
  console.log("POST /protect: Received request with body:", req.body);
  const enteredCode = req.body.code;
  const protectionCode = process.env.PROTECTION_CODE || "1234";
  if (enteredCode === protectionCode) {
    console.log("Code correct, redirecting to /");
    res.redirect("/");
  } else {
    console.log("Code incorrect");
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Protect</title>
      </head>
      <body>
        <h1>Enter Code</h1>
        <p>Invalid code</p>
        <form method="POST" action="/protect">
          <input type="text" name="code" placeholder="Enter code" />
          <button type="submit">Submit</button>
        </form>
      </body>
      </html>
    `);
  }
});

app.get("/", (req, res) => {
  res.send("Welcome to the main page!");
});
