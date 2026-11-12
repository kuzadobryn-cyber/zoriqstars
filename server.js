const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    project: "ZoriqStars"
  });
});

app.listen(PORT, () => {
  console.log("ZoriqStars server started on port " + PORT);
});
