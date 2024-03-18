const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");

const app = express();
app.use(express.json());

let db = null;

const initializeDBandServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("Server is running on https://localhost:3000/");
    });
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
};

initializeDBandServer();

const requestedFollowingTweet = (tweetId, data) => {
  return data.forSome((eachItem) => eachItem.tweet_id === tweetId);
};

const authenticateToken = async (request, response, next) => {
  let jwToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwToken = authHeader.split(" ")[1];
  }
  if (jwToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwToken, "MY_SECRETE_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `SELECT * FROM user WHERE username='${username}'`;
  const userDetails = await db.get(getUserQuery);
  if (userDetails === undefined) {
    const registerUserQuery = `
        INSERT INTO user(name,username,password,gender)
        VALUES(
            '${name}','${username}','${hashedPassword}','${gender}'
        )
        `;
    if (password.length >= 6) {
      await db.run(registerUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserDetailsQuery = `SELECT * FROM user WHERE username='${username}'`;
  const userDetails = await db.get(getUserDetailsQuery);
  if (userDetails === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      userDetails.password
    );
    if (isPasswordMatched) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRETE_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
  const userId = await db.get(getUserIdQuery);
  const followerUserId = userId.user_id;

  const getTweetsQuery = `
  SELECT T.username , tweet.tweet,tweet.date_time as dateTime FROM (
      user INNER JOIN follower on 
      user.user_id=follower.follower_id
  ) AS T
   INNER JOIN tweet on 
  T.following_user_id=tweet.user_id 
  WHERE T.follower_user_id=${followerUserId}
  ORDER BY tweet.date_time DESC 
  LIMIT 4
  `;
  const data = await db.all(getTweetsQuery);
  response.send(data);
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
  const userId = await db.get(getUserIdQuery);
  const followerUserId = userId.user_id;
  const getFollowingUsersQuery = `
  SELECT username as name FROM 
  user inner join follower on user.user_id=follower.follower_user_id 
  GROUP BY username
  `;
  const data = await db.all(getFollowingUsersQuery);
  response.send(data);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
  const userId = await db.get(getUserIdQuery);
  const followingUserId = userId.user_id;

  const getFollowersQuery = `
  SELECT username as name FROM user inner join follower
  ON user.user_id=follower.following_user_id 
  WHERE user.user_id=${followingUserId}
  GROUP BY username
  `;
  const data = await db.all(getFollowersQuery);
  response.send(data);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  console.log(tweetId);
  const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
  const userId = await db.get(getUserIdQuery);
  const followerUserId = userId.user_id;
  const getFollowingUserTweetIdsQuery = `
  SELECT tweet_id FROM (
      user inner join follower on user.user_id=follower.follower_user_id
  ) as T inner join tweet on T.following_user_id=tweet.user_id 
  GROUP BY tweet_id
  
  `;
  const data = await db.all(getFollowingUserTweetIdsQuery);
  let tweetList = [];
  data.map((eachItem) => tweetList.push(eachItem.tweet_id));

  console.log(tweetList);
  console.log(!tweetList.includes(tweetId));

  if (!tweetList.includes(tweetId)) {
    const getTweetDetailsQuery = `
      SELECT tweet,count(like_id) as likes,count(reply_id) as replies,date_time as dateTime FROM tweet LEFT JOIN (
          reply INNER JOIN like on reply.tweet_id=like.tweet_id 
      ) as T 
      WHERE tweet.tweet_id=${tweetId} 
    
      `;
    const tweetsData = await db.all(getTweetDetailsQuery);

    response.send(tweetsData);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    console.log(tweetId);

    const getFollowingUserTweetIdsQuery = `
  SELECT tweet_id FROM (
      user inner join follower on user.user_id=follower.follower_user_id
  ) as T inner join tweet on T.following_user_id=tweet.user_id 
  GROUP BY tweet_id
  
  `;
    const data = await db.all(getFollowingUserTweetIdsQuery);
    let tweetList = [];
    data.map((eachItem) => tweetList.push(eachItem.tweet_id));

    if (!tweetList.includes(tweetId)) {
      const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
      const userId = await db.get(getUserIdQuery);
      const followerUserId = userId.user_id;
      const getLikedIdsQuery = `
    SELECT username FROM user INNER JOIN like on user.user_id=like.user_id 
    WHERE like.tweet_id=${tweetId}
    `;
      const data = await db.all(getLikedIdsQuery);
      let likesList = [];
      data.map((eachItem) => likesList.push(eachItem.username));
      response.send({ likes: likesList });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
    const userId = await db.get(getUserIdQuery);
    const followerUserId = userId.user_id;

    const getFollowingUserTweetIdsQuery = `
  SELECT tweet_id FROM (
      user inner join follower on user.user_id=follower.follower_user_id
  ) as T inner join tweet on T.following_user_id=tweet.user_id 
  GROUP BY tweet_id
  
  `;
    const data = await db.all(getFollowingUserTweetIdsQuery);
    let tweetList = [];
    data.map((eachItem) => tweetList.push(eachItem.tweet_id));
    if (!tweetList.includes(tweetId)) {
      const getRepliesListQuery = `
       SELECT name,reply from user NATURAL JOIN reply  WHERE reply.tweet_id=${tweetId}
       `;
      const data = await db.all(getRepliesListQuery);
      response.send({ replies: data });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
  const userIdObject = await db.get(getUserIdQuery);
  const userId = userIdObject.user_id;

  const getTweetDetailsQuery = `
      SELECT tweet,count(like_id) as likes,count(reply_id) as replies,date_time as dateTime FROM tweet LEFT JOIN (
          reply INNER JOIN like on reply.tweet_id=like.tweet_id 
      ) as T 
      WHERE tweet.user_id='${userId}' 
    
      `;
  const tweetsData = await db.all(getTweetDetailsQuery);
  response.send(tweetsData);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
  const userIdObject = await db.get(getUserIdQuery);
  const userId = userIdObject.user_id;
  const createTweetQuery = `
  INSERT INTO tweet(tweet,user_id,date_time) 
  VALUES('${tweet}',${userId},DATETIME('now'))
  
  `;
  await db.run(createTweetQuery);
  console.log("hi");
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const getUserIdQuery = `
    SELECT user.user_id FROM  user where username='${username}'
    `;
    const userIdObject = await db.get(getUserIdQuery);
    const userId = userIdObject.user_id;
    const getTweetsList = `
  SELECT tweet_id from tweet inner join user on user.user_id=tweet.user_id 
  WHERE user.user_id=${userId}
  `;
    const tweetsList = await db.all(getTweetsList);
    let tweetsIdList = [];
    tweetsList.map((eachItem) => tweetsIdList.push(eachItem.tweet_id));

    if (!tweetsIdList.includes(tweetId)) {
      const removeTweetQuery = `
        DELETE FROM tweet 
        WHERE tweet_id=${tweetId}
        `;
      await db.run(removeTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);


module.exports=app;