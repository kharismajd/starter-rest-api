const line = require('@line/bot-sdk')
const dotenv = require("dotenv")
const JSSoup = require("jssoup").default
const scheduler = require("node-schedule")
const stringUtil = require("../util/stringUtil")
const dateUtil = require("../util/dateUtil")
const sixOutbound = require("../outbound/sixOutbound")
const sixService = require("./sixService")
const tokopediaService = require("./tokopediaService")

dotenv.config()

const configuration = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
}

const client = new line.Client(configuration)
const userId = process.env.USER_ID;

async function replyText(text, replyToken) {
    await client.replyMessage(replyToken, {type: 'text', text: text}, false)
}

function isReadyToAttend(attendanceForm) {
    return attendanceForm.find("button", {"id": "form_hadir"}) ? true : false
}

async function tryToAttend(id) {
    const attendanceForm = await sixOutbound.getSchedule(id)
    const attendanceFormSoup = new JSSoup(attendanceForm.data)

    if (!isReadyToAttend(attendanceFormSoup)) {
        return false
    }

    const returnTo = attendanceFormSoup.find("input", {"id": "form_returnTo"}).attrs["value"]
    const token = attendanceFormSoup.find("input", {"id": "form__token"}).attrs["value"]

    await sixOutbound.markAsAttended(id, token, returnTo)
    return true
}

function scheduleAutoAttend(todaySchedule) {
    todaySchedule.classes.forEach(schedule => {
        const rule = new scheduler.RecurrenceRule();
        rule.minute = new scheduler.Range(0, 59, 3);
        const startDate = dateUtil.plusHours(schedule.startDate, -7)
        const endDate = dateUtil.plusHours(schedule.endDate, -7)
        const jobAttendanceReminder = scheduler.scheduleJob(schedule.name + "reminder" , startDate - 300000, async function() {
            var text = "Hello master, your class " + schedule.name + " at " + schedule.location + " will start in 5 minutes"
            text += "\n\nMiku will tell you when the attendance form is openned :3"
            await client.pushMessage(userId, { type: 'text', text: text }, false)
        })
        const jobAttendanceFailed = scheduler.scheduleJob(schedule.name + "failed" , endDate, async function() {
            var text = "Hmmm, looks like the attendance form is not openned at all :(. Did the lecturer record the attendance manually master?"
            await client.pushMessage(userId, { type: 'text', text: text }, false)
        })
        const jobAttendance = scheduler.scheduleJob(schedule.name ,{ start: startDate, end: endDate, rule: rule }, async function() {
            try {
                const isSuccess = await tryToAttend(schedule.id);
                if (isSuccess) {
                    scheduler.scheduledJobs[schedule.name].cancel()
                    scheduler.scheduledJobs[schedule.name + "reminder"].cancel()
                    scheduler.scheduledJobs[schedule.name + "failed"].cancel()
                    var text = "Attendace form for " + schedule.name + " has openned and Miku has successfully to mark as attended for you"
                    text += "\n\nNow you can focus on your study :3"
                    await client.pushMessage(userId, { type: 'text', text: text }, false)
                }
            }
            catch (e) {
                scheduler.scheduledJobs[schedule.name].cancel()
                scheduler.scheduledJobs[schedule.name + "reminder"].cancel()
                scheduler.scheduledJobs[schedule.name + "failed"].cancel()
                console.log(error.message)
                var text = "Attendace form for " + schedule.name + " has openned and Miku has failed to mark as attended for you"
                text += "\n\nPlease check the attendance formm and sorry for not being able to help T_T"
                await client.pushMessage(userId, { type: 'text', text: text }, false)
            }
        })
    })
}

function createLeftBoxContent(classes) {
    const startTime = stringUtil.pad(classes.startDate.getHours(), 2) + ":" + stringUtil.pad(classes.startDate.getMinutes(), 2)
    const endTime = stringUtil.pad(classes.endDate.getHours(), 2) + ":" + stringUtil.pad(classes.endDate.getMinutes(), 2)

    const leftBoxContent = []
    leftBoxContent.push({
        'type': 'text',
        'text': startTime,
        'gravity': 'top',
        'align': 'end',
        'weight': 'bold',
        'size': 'xs'
    })
    leftBoxContent.push({
        'type': 'text',
        'text': '~',
        'gravity': 'top',
        'align': 'end',
        'size': 'xxs'
    })
    leftBoxContent.push({
        'type': 'text',
        'text': endTime,
        'gravity': 'top',
        'align': 'end',
        'weight': 'bold',
        'size': 'xs'
    })
    return leftBoxContent
}

function createRightBoxContent(classes) {
    const rightBoxContent = []
    rightBoxContent.push({
        'type': 'text',
        'text': classes.name,
        'gravity': 'top',
        'size': 'xs',
        'color': '#101010',
        'wrap': true
    })
    rightBoxContent.push({
        'type': 'text',
        'text': classes.location,
        'gravity': 'bottom',
        'size': 'xxs',
        'color': '#999999'
    })
    return rightBoxContent
}

function wrapClassRow(leftBoxContent, rightBoxContent) {
    return {
        'type': 'box',
        'layout': 'horizontal',
        'spacing': 'md',
        'contents': [
            {
                'type': 'separator'
            },
            {
                'type': 'box',
                'layout': 'vertical',
                'contents': leftBoxContent,
                'flex': 2
            },
            {
                'type': 'box',
                'layout': 'vertical',
                'contents': rightBoxContent,
                'flex': 8
            }
        ]
    }
}

function wrapClassMessage(contents) {
    return {
        'type': 'flex',
        'altText': 'Your classes for today!',
        'contents': {
            'type': 'bubble',
            'body': {
                'type': 'box',
                'layout': 'vertical',
                'spacing': 'md',
                'contents': contents
            }
        }
    }
}

async function notifyError(message) {
    var text = "Sorry master, There seems to be an error in Miku's system :(. Please help to fix it so Miku can give her best to help master :D"
    text += "\n\nError message: " + message
    await client.pushMessage(userId, {type: 'text', text: text}, false)
}

async function notifyOrders() {
    try {
        const orders = await tokopediaService.getAllOrders()

        if (orders.arrived.length === 0 && orders.shipped.length === 0 && orders.processed.length === 0) {
            return
        }

        var text = "Hello master, there are updates about master's order on Tokopedia :3\n\n----------------------------------------"

        orders.arrived.forEach(order => {
            order.items.forEach(item => {
                text += "\n- " + item
            })
            text += "\n\nStatus: Arrived at destination :D"
            text += "\n----------------------------------------"
        });
        orders.shipped.forEach(order => {
            order.items.forEach(item => {
                text += "\n- " + item
            })
            text += "\n\nStatus: " + order.log
            text += "\n----------------------------------------"
        });
        orders.processed.forEach(order => {
            order.items.forEach(item => {
                text += "\n- " + item
            })
            text += "\n\nStatus: Processed :)"
            text += "\n----------------------------------------"
        })

        text += "\n\nThat's all, keep your spirit for the rest of the day :D"

        await client.pushMessage(userId, {type: 'text', text: text}, false)
    } catch(error) {
        console.log(error.message)
        notifyError("Cannot get all orders")
        return
    }
}

async function notifyTodaySchedule() {
    try {
        const schedule = await sixService.getTodaySchedule()

        if (!schedule) {
            return
        }

        const text = "Good morning master, have you woken up yet? Here's your class schedule for today. Do your best and don't be late :3"
        const rows = []
        schedule.classes.forEach(classes => {
            const leftBoxContents = createLeftBoxContent(classes)
            const rightBoxContents = createRightBoxContent(classes)
            const content = wrapClassRow(leftBoxContents, rightBoxContents)
            rows.push(content)
        })
        const message = wrapClassMessage(rows)

        const classesMessage = [
            {
                'type': 'text',
                'text': text
            },
            message
        ]

        await client.pushMessage(userId, classesMessage, false)
        scheduleAutoAttend(schedule)
    } catch(error) {
        console.log(error.message)
        notifyError("Cannot get today schedule")
        return
    }
}

async function notifySleep() {
    const text = "Hello master, Miku will sleep now. Please refrain from waking me up so Miku will be ready to help you tomorrow \n\nGood night ;)"
    await client.pushMessage(userId, {type: 'text', text: text}, false)
}

module.exports = {
    replyText,
    notifyOrders,
    notifySleep,
    notifyTodaySchedule,
    configuration,
}
