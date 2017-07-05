/**
 * Created by Orion Wolf_Hubbard on 7/3/2017.
 */

//server
let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io')(http);
let port = process.env.PORT || 3000;
app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html') });
http.listen(port,() => { console.log('listening on *:' + port) });

let userMap = {};
let passMap ={};
let lobby = {};
let tables = {};
let games = {};

const newUser = function (id) {
    this.id = id;
    this.name = 'guest';
    this.tableId = 'none';
    this.points = 0;
    this.turns = 0;
    this.ready = 'no';
};

const newWell = function (story, who) {
    this.name = who;
    this.story = story;
    this.likedBy = [];
};

const newTable = function (tableId, prompt, turns) {
    this.info = new info(tableId, prompt, turns);
};

const info = function (tableId, prompt, turns) {
    this.id = tableId;
    this.wells = [];
    this.points = 0;
    this.prompt = prompt;
    this.turns = turns;
};

io.on('connection', socket => {
    let user = new newUser(socket.id);
    userMap[user.id] = user;
    
    io.to(user.id).emit('setup_login', lobby);

    socket.on('login', namePass => {
        
        if (namePass[0] in passMap) {
            
            if (passMap[namePass[0]] === namePass[1]) {
                
                user.name = namePass[0];
                
            }
            
        } else {
            
            passMap[namePass[0]] = namePass[1];
            user.name = namePass[0];
            
        }
        
        if (user.name !== 'guest') {
            lobby[user.name] = user.id;
            io.to(user.id).emit('get_name', user.name);
            
            for (let name in lobby) {
                io.to(lobby[name]).emit('lobby', { lobby: lobby, tables: tables, user: userMap[lobby[name]] } );
            }
            
        }
        
    });
    
    socket.on('private', data => {
        io.to(data.to).emit('chat', `${user.name} wispers: ${data.message}`);
    });
    
    socket.on('chat', msg => {
        if (user.name in lobby || user.name === 'guest') {
            for (let person in lobby){
                io.to(lobby[person]).emit('chat', `${user.name}: ${msg}`);
            }
        }
        
        //TODO add if user.tableId in games or whatever { chat to table }
    });
    
    socket.on('new_table', data => {
        if (user.tableId === 'none' && data.turns > 0 && data.turns < 11) {
            let tableId = Math.random().toString(36).substr(2, 5);
            user.tableId = tableId;
            tables[tableId] = new newTable(tableId, data.prompt, data.turns);
            tables[tableId][user.name] = user;
    
            for (let name in lobby) {
                io.to(lobby[name]).emit('lobby', { lobby: lobby, tables: tables, user: userMap[lobby[name]] } );
            }
        }
    });
    
    socket.on('join_table', tableId => {
       
        if (user.tableId === 'none') {
            user.tableId = tableId;
            tables[tableId][user.name] = user;
            
            for (let name in lobby) {
                io.to(lobby[name]).emit('lobby', { lobby: lobby, tables: tables, user: userMap[lobby[name]] } );
            }
        }
    });
    
    socket.on('leave', () => {
        
        if (user.tableId !== 'none') {
            delete tables[user.tableId][user.name];
    
            if (countKeys(tables[user.tableId]) === 1)
                delete tables[user.tableId];
            
            user.tableId = 'none';
            
            for (let name in lobby) {
                io.to(lobby[name]).emit('lobby', { lobby: lobby, tables: tables, user: userMap[lobby[name]] } );
            }
            
        }
        
    });
    
    socket.on('ready', () => {
        let table = tables[user.tableId];
        if (user.ready === 'yes')
            table[user.name].ready = 'no';
        else table[user.name].ready = 'yes';
    
        let count = 0;
        let readyCount = 0;
        for (let key in table) {
            if (key !== 'info') {
                count++;
                if (table[key].ready === 'yes')
                    readyCount++;
            }
        }
        
        if (count === readyCount && count > 1)
            startGame(user.tableId);
        
        for (let name in lobby)
            io.to(lobby[name]).emit('lobby', { lobby: lobby, tables: tables, user: userMap[lobby[name]]} );
        
    });
    
    socket.on('disconnect', () => {
        
        if (user.tableId !== 'none') {
            delete tables[user.tableId][user.name];
            if (countKeys(tables[user.tableId]) === 1)
                delete tables[user.tableId];
            
        }
        
        if (user.name in lobby) {
            delete lobby[user.name];
    
            for (let name in lobby) {
                io.to(lobby[name]).emit('lobby', { lobby: lobby, tables: tables, user: userMap[lobby[name]]} );
            }
        }
        
        delete userMap[user.id]
    });
    
    socket.on('turn', story => {
        let game = games[user.tableId];
        
        game[user.name].ready = false;
        game[user.name].turns++;
        
        game.info.wells.push(new newWell(story, user.name));
    
        game[nextWriter(user.tableId)].ready = true;
    
        for (let person in game) {
            if (person !== 'info') {
                io.to(game[person].id).emit('game', game);
            }
        }
        
    });
    
});

const startGame = tableId => {
    let game = tables[tableId];
    games[tableId] = game;
    delete tables[tableId];
    
    for (let person in game) {
        if (person !== 'info') {
            delete lobby[game[person].name];
            game[person].ready = false;
            io.to(game[person].id).emit('setup_game');
        }
    }
    
    game[nextWriter(tableId)].ready = true;
    
    for (let name in lobby)
        io.to(lobby[name]).emit('lobby', { lobby: lobby, tables: tables, user: userMap[lobby[name]]} );
    
    for (let person in game) {
        if (person !== 'info') {
            io.to(game[person].id).emit('game', game);
        }
    }
};

const countKeys = obj => {
    let count = 0;
    for (let key in obj)
        count++;
    return count;
};

const nextWriter = gameId => {
    
    let game = games[gameId];
    
    //find lowest number of turns
    let turns = 100;
    for (let person in game) {
        if (person !== 'info') {
            if (game[person].turns < turns)
                turns = game[person].turns;
        }
    }
    
    if (turns === game.info.turns)
        endGame(gameId);//TODO
    
    //make array of players with that many turns
    let players = [];
    for (let person in game) {
        if (person !== 'info') {
            if (game[person].turns === turns)
                players.push(person);
        }
    }
    
    return players[Math.floor(Math.random() * players.length)];
    
};

