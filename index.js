require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')
const nodemailer = require("nodemailer");
const stripe = require('stripe')(process.env.STRIP_SECRUIT_KEY);

const port = process.env.PORT || 3000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

// Create and check Jwt verifyToken 
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// send email using Nodemailer
const sendEmail = (emailAddress, emailBody) => {
  // create transporter
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.NODEMAILER_USER_EMAIL,
      pass: process.env.NODEMAILER_APP_PASS,
    },
    tls: {
      rejectUnauthorized: false, //certificate check 
    },
  });
  // transport email verify
  transporter.verify((error, success) => {
    if (error) {
      console.log(error)
    } else {
      console.log('transporter is ready for send email', success)
    }
  })

  // send email
  const sendEmail = {
    from: process.env.NODEMAILER_USER_EMAIL, // sender address
    to: emailAddress, // list of receivers
    subject: emailBody?.subject, // Subject line
    text: emailBody?.message, // plain text body
    // html: "<b>Hello world?</b>", // html body
  }
  transporter.sendMail(sendEmail, (error, info) => {
    if (error) {
      console.log(error)
    } else {
      console.log('send email: ', info)
    }
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.oo75q.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {

    const db = client.db('plantNet-project')
    const usersCollection = db.collection("users")
    const plantsCollection = db.collection('plants')
    const ordersCollection = db.collection('orders')

    // Create Admin Verified Middleware
    const verifyAdmin = async (req, res, next) => {
      // console.log("data from verifyToken Middleware----->",req.user?.email)
      const email = req.user?.email;
      const query = { email }
      const result = await usersCollection.findOne(query)
      if (!result || result?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden Access! Admin Only Action" })
      }

      next()
    }
    // Create seller Verified Middleware
    const verifySeller = async (req, res, next) => {
      // console.log("data from verifyToken Middleware----->",req.user?.email)
      const email = req.user?.email;
      const query = { email }
      const result = await usersCollection.findOne(query)
      if (!result || result?.role !== "seller") {
        return res.status(403).send({ message: "Forbidden Access! seller Only Action" })
      }

      next()
    }


    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })



    // User collections data
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = req.body;
      const isExist = await usersCollection.findOne(query)
      if (isExist) {
        return res.send(isExist)
      }
      const result = await usersCollection.insertOne({ ...user, role: 'customer', timeStamp: Date.now() })
      res.send(result)
    })
    // User status updated
    app.patch('/user/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = await usersCollection.findOne(query)
      if (!user || user?.status === 'Requested') {
        return res.status(400).send("User already requested . Wait for some time")
      }
      const updateDoc = {
        $set: {
          status: "Requested"
        }
      }
      const result = await usersCollection.updateOne(query, updateDoc)
      res.send(result)
    })
    // User role get
    app.get('/user/role/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email })
      res.send({ role: result?.role })
    })




    // Plants data get db
    app.get('/plants', async (req, res) => {
      const result = await plantsCollection.find().toArray()
      res.send(result)
    })

    app.get('/plants/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await plantsCollection.findOne(query)
      res.send(result)
    })




    // order save to database
    app.post('/order', verifyToken, async (req, res) => {
      const purchase = req.body;
      const result = await ordersCollection.insertOne(purchase)
      // send Email
      if (result?.insertedId) {
        // send customer
        sendEmail(purchase?.customer?.email, {
          subject: 'Order Successful!',
          message: `You've placed On Order Successfully!. transactionId ${result?.insertedId}  `
        })
        // send email seller
        sendEmail(purchase?.seller, {
          subject: 'Hurry! .You Have an Order to process',
          message: `Get The Plant Ready for!.  ${purchase?.customer?.name}  `
        })
      }
      res.send(result)
    })

    // Quantity updated
    app.patch('/order/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const { UpdateQuantity, status } = req.body;
      const filter = { _id: new ObjectId(id) }
      let updateDoc = {
        $inc: { quantity: -UpdateQuantity }
      }
      if (status === 'increase') {
        updateDoc = {
          $inc: { quantity: UpdateQuantity }
        }
      }
      const result = await plantsCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    // View My Orders
    app.get('/customer-orders/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.aggregate([
        {
          $match: { 'customer.email': email }
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' }
          },
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plants'
          },
        },
        {
          $unwind: '$plants'
        },
        {
          $addFields: {
            name: '$plants.name',
            image: '$plants.image',
            category: '$plants.category',
          },
        },
        {
          $project: {
            plants: 0,
          }
        }

      ]).toArray()
      // const result=await ordersCollection.find(query).toArray()
      res.send(result)
    })

    // Cancel order
    app.delete('/order-delete/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const order = await ordersCollection.findOne(query)
      if (order.status === 'Delivered') {
        return res.status(409).send('cannot cancel once the product is Delivered!')
      }
      const result = await ordersCollection.deleteOne(query)
      res.send(result)
    })


    // Create payment intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const { quantity, plantId } = req.body;
      const plant = await plantsCollection.findOne({ _id: new ObjectId(plantId) })
      if (!plant) {
        return res.status(400).send({ message: 'Plant Not found' })
      }
      const totalPrice = quantity * plant?.price * 100;  //total price convert dollar to cent
      const { client_secret } = await stripe.paymentIntents.create({
        amount: totalPrice,
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
      });
      res.send({ clientSecret: client_secret })
    })





    // Get all users
    app.get("/all-users/:email", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const query = { email: { $ne: email } }
      const result = await usersCollection.find(query).toArray()
      res.send(result)
    })

    // Update user role && status
    app.patch('/user/role/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      const query = { email }
      const updateDoc = {
        $set: { role, status: "Verified" }
      }
      const result = await usersCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    // Admin stat
    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const totalUsers = await usersCollection.estimatedDocumentCount()
      const totalPlants = await plantsCollection.estimatedDocumentCount()

      // const allOrders = await ordersCollection.find().toArray()
      // const totalOrders = allOrders.length;
      // const totalPrice = allOrders.reduce((sum, order) => sum + order.price, 0)


      // Chart details
      const chartData = await ordersCollection.aggregate([
        { $sort: { _id: -1 } },
        {
          $addFields: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: { $toDate: '$_id' }
              }
            },
            quantity: {
              $sum: '$quantity'
            },
            price: { $sum: '$price' },
            order: { $sum: 1 }
          },
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            quantity: 1,
            price: 1,
            order: 1
          }
        }
      ]).toArray()

      const orderDetails = await ordersCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$price' },
            totalOrders: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0
          }
        }
      ])
        .next()
      res.send({ totalUsers, totalPlants, ...orderDetails, chartData })
    }
    )





    // add Plants db
    app.post('/plants', async (req, res) => {
      const plants = req.body;
      const result = await plantsCollection.insertOne(plants)
      res.send(result)
    })

    // My inventory plants get
    app.get("/plants/seller", verifyToken, verifySeller, async (req, res) => {
      const email = req.user?.email
      const query = { 'seller.email': email }
      const result = await plantsCollection.find(query).toArray()
      res.send(result)
    })

    // delete My Inventory Plant
    app.delete('/plant/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await plantsCollection.deleteOne(query)
      res.send(result)
    })

    // Seller Orders Manage
    app.get('/seller-orders/:email', verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.aggregate([
        {
          $match: { 'seller': email }
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' }
          },
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plants'
          },
        },
        {
          $unwind: '$plants'
        },
        {
          $addFields: {
            name: '$plants.name',
          },
        },
        {
          $project: {
            plants: 0,
          }
        }

      ]).toArray()
      // const result=await ordersCollection.find(query).toArray()
      res.send(result)
    })

    // Order Status Update By Seller
    app.patch('/orders/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { status }
      }
      const result = await ordersCollection.updateOne(query, updateDoc)
      res.send(result)
    })












    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
