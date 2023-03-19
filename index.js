const { Configuration, OpenAIApi } = require("openai");
const {Client} = require("whatsapp-web.js")
const qrcode = require("qrcode-terminal")
require("dotenv").config()

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});

const openai = new OpenAIApi(configuration);
const client = new Client()

client.on('qr', (qr) => {
	qrcode.generate(qr, {small: true})
})

client.on('read', () => {
	console.log('client is ready!')
})

client.on('message', async message => {
	if(!message.hasMedia) {
		const {body} = message
		console.log(body)
		try {
			const response = await openai.createChatCompletion({model: "gpt-3.5-turbo", messages:[{role: "user", content: body}]});
			const messageData = response.data.choices[0].message.content.trim()
			console.log(messageData)
		message.reply(messageData);
		} catch(e) {
			console.log(e);
			message.reply("Something went wrong");
		}
	}
})

client.initialize()
