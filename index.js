const express = require('express');
const line = require('@line/bot-sdk')
const lineBotService = require("./service/lineBotService");
const tokopediaService = require("./service/tokopediaService");
const dotenv = require("dotenv")

dotenv.config()

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/', function(req, res){
  res.status(200).send('OK')
})

app.post('/callback', line.middleware(lineBotService.configuration), function(req, res){
  req.body.events.map(event => {
      const replyText = "Hello master, these are the features that master has given to Miku XD:\n\n- Miku will give updates about master's order on Tokopedia every 9AM\n\nThat's all, please give Miku more features in the future :3";
      lineBotService.replyText(replyText, event.replyToken)
  })
  res.status(200).send('OK')
})

app.post('./miku-tokped-update', async function(req, res) {
  const notify = req.query.notify;
  await tokopediaService.getAllOrders(notify);
  res.status(200).send('OK');
})

app.post('./miku-sleep', async function(req, res) {
  await lineBotService.sleep();
  res.status(200).send('OK');
})

// Start the server
const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`index.js listening on ${port}`)
})
