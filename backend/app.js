require('dotenv').config();
const express = require('express');
const { Client } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// GitHub Pages URL'inizi girin:
const allowedOrigin = 'https://stratovarious.github.io'; // Örnek URL

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST'],
  credentials: true,
}));

// PostgreSQL Veritabanı Bağlantısı
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
client.connect(err => {
  if (err) console.error('Veritabanı bağlantı hatası:', err);
  else console.log('Veritabanına bağlanıldı.');
});

app.get('/', (req, res) => {
  res.send('Stonemu Backend Çalışıyor!');
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

let waitingPlayer = null;
let games = {};

// Tam satranç mantığı için kapsamlı bir sunucu tarafı satranç sınıfı.
// Rok, en passant, şah mat kontrolü, tam hamle üretimi içerir.
class ServerChessLogic {
  constructor() {
    this.loadFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  }

  reset() {
    this.loadFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  }

  // ... (Tam satranç mantığı buraya gelecek, aynen chess.js’deki gibi)
  // Aşağıda chess.js’de yazdığımız tüm fonksiyonları birebir kopyalıyoruz
  loadFen(fen) {
    let parts = fen.split(' ');
    let position = parts[0];
    this.activeColor = parts[1];
    this.castlingRights = parts[2];
    this.enPassantTarget = parts[3] === '-' ? null : parts[3];
    this.halfmoveClock = parseInt(parts[4],10);
    this.fullmoveNumber = parseInt(parts[5],10);

    this.board = [];
    let rows = position.split('/');
    for (let i=0; i<8; i++) {
      let row = rows[i].split('');
      let boardRow = [];
      for (let j=0; j<row.length; j++) {
        let c = row[j];
        if (/[1-8]/.test(c)) {
          let emptyCount = parseInt(c,10);
          for (let k=0; k<emptyCount; k++) boardRow.push("");
        } else {
          boardRow.push(c);
        }
      }
      this.board.push(boardRow);
    }
  }

  fen() {
    let fenRows = [];
    for (let i=0; i<8; i++) {
      let empty=0;
      let rowFen="";
      for (let j=0;j<8;j++){
        let piece=this.board[i][j];
        if(piece==="") {
          empty++;
        } else {
          if(empty>0){
            rowFen+=empty;
            empty=0;
          }
          rowFen+=piece;
        }
      }
      if(empty>0) rowFen+=empty;
      fenRows.push(rowFen);
    }
    let fenPos=fenRows.join('/');
    let ep = this.enPassantTarget?this.enPassantTarget:'-';
    return fenPos+" "+this.activeColor+" "+this.castlingRights+" "+ep+" "+this.halfmoveClock+" "+this.fullmoveNumber;
  }

  turn() {
    return this.activeColor;
  }

  game_over() {
    let moves = this.getAllValidMovesForTurn();
    if(moves.length>0) return false;
    // moves yok, eğer şah tehdit altındaysa mat, değilse pat
    if (this.inCheck(this.activeColor)) {
      return true; // checkmate
    } else {
      return true; // stalemate
    }
  }

  move(m) {
    // Bulunduğumuz renk sıra
    let moves = this.getAllValidMovesForTurn();
    let chosen = moves.find(M=>M.from===m.from && M.to===m.to);
    if(!chosen) return null;

    this.makeMove(chosen);
    return m;
  }

  getAllValidMovesForTurn() {
    // Tüm hamleleri üret, şahta kalmayanları al
    let moves=this.generateMoves(this.activeColor);
    // Filtre illegal moves
    let legal=[];
    for (let mv of moves) {
      this.makeMove(mv);
      if(!this.inCheck(this.activeColor=== 'w'?'b':'w')) {
        legal.push(mv);
      }
      this.undoMove();
    }
    return legal;
  }

  getValidMoves(square) {
    // Belirli kareden hamleler
    let all = this.getAllValidMovesForTurn();
    return all.filter(m=>m.from===square);
  }

  // Aşağıda chess logic fonksiyonları (rookMoves,bishopMoves,knightMoves,pawnMoves,kingMoves),
  // castling, en passant, check detection ekleniyor.
  isOnBoard(r,f){return r>=0 && r<8 && f>=0 && f<8;}

  pieceAt(r,f){return this.board[r][f];}

  colorOf(piece) {
    if(piece==="") return null;
    return piece===piece.toUpperCase()?'w':'b';
  }

  inCheck(color) {
    // Bul king'i
    let kingPos = this.findKing(color);
    if(!kingPos) return false;
    return this.squareAttackedBy(kingPos.r, kingPos.f, color==='w'?'b':'w');
  }

  findKing(color) {
    for(let r=0;r<8;r++){
      for(let f=0;f<8;f++){
        let p=this.board[r][f];
        if(p!==""){
          let c=this.colorOf(p);
          if(c===color && p.toLowerCase()==='k') return {r,f};
        }
      }
    }
    return null;
  }

    squareAttackedBy(r,f,attColor) {
    // Bir kare attColor tarafından saldırıda mı?
    // Tüm attColor taşların hamlelerini simüle edelim.
    // Performans için optimize etmeden basit yapıyoruz:
    // Tüm attColor taşlarını bul ve bak
    for(let rr=0;rr<8;rr++){
      for(let ff=0;ff<8;ff++){
        let p=this.board[rr][ff];
        if(p!=="" && this.colorOf(p)===attColor){
          // pseudo moves of p includes (r,f)?
          let moves=this.pseudoMoves(rr,ff,p);
          if(moves.some(m=>m.tr===r&&m.tf===f))return true;
        }
      }
    }
    return false;
  }

  pseudoMoves(r,f,piece){
    // Hamle üretimi: Rok, at, fil, vezir, şah, piyonun pseudo hamleleri. 
    let color=this.colorOf(piece);
    let mvs=[];
    const add=(tr,tf)=>{
      mvs.push({fr:r,ff:f,tr,tf});
    };

    const isOpp=(tr,tf)=>(this.isOnBoard(tr,tf) && this.pieceAt(tr,tf)!=="" && this.colorOf(this.pieceAt(tr,tf))!==color);
    const isEmpty=(tr,tf)=>(this.isOnBoard(tr,tf) && this.pieceAt(tr,tf)==="");

    let pieceType=piece.toLowerCase();
    if(pieceType==='p') {
      let dir=color==='w'?-1:1;
      let startRank=color==='w'?6:1;
      let fr=r+dir;
      if(this.isOnBoard(fr,f) && this.pieceAt(fr,f)==="") add(fr,f);
      if(r===startRank && this.isOnBoard(fr+dir,f) && this.pieceAt(fr+dir,f)==="" && this.pieceAt(fr,f)==="") add(fr+dir,f);
      [f-1,f+1].forEach(tf=>{
        if(this.isOnBoard(fr,tf)){
          let tP=this.pieceAt(fr,tf);
          if(tP!==""&&this.colorOf(tP)!==color) add(fr,tf);
          // en passant
          if(this.enPassantTarget && this.squareToCoords(this.enPassantTarget).r===fr && this.squareToCoords(this.enPassantTarget).f===tf) {
            add(fr,tf);
          }
        }
      });
    }
    else if(pieceType==='n'){
      let offs=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for(let off of offs){
        let tr=r+off[0],tf=f+off[1];
        if(this.isOnBoard(tr,tf)){
          let tp=this.pieceAt(tr,tf);
          if(tp===""||this.colorOf(tp)!==color) add(tr,tf);
        }
      }
    }
    else if(pieceType==='b'){
      this.addSliding(r,f,color,mvs,[[-1,-1],[-1,1],[1,-1],[1,1]]);
    }
    else if(pieceType==='r'){
      this.addSliding(r,f,color,mvs,[[ -1,0],[1,0],[0,-1],[0,1]]);
    }
    else if(pieceType==='q'){
      this.addSliding(r,f,color,mvs,[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    }
    else if(pieceType==='k'){
      let kingOff=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for(let off of kingOff) {
        let tr=r+off[0],tf=f+off[1];
        if(this.isOnBoard(tr,tf)){
          let tp=this.pieceAt(tr,tf);
          if(tp===""||this.colorOf(tp)!==color) add(tr,tf);
        }
      }
      // Rok (Castling)
      // Castling rights fen: KQkq
      let canCastleKing=(color==='w'?this.castlingRights.includes('K'):this.castlingRights.includes('k'));
      let canCastleQueen=(color==='w'?this.castlingRights.includes('Q'):this.castlingRights.includes('q'));
      let rank = color==='w'?7:0;
      if(r===rank && f===4) {
        // kısa rok
        if(canCastleKing && this.pieceAt(rank,5)==="" && this.pieceAt(rank,6)===""
           && !this.squareAttackedBy(rank,4,this.opColor(color))
           && !this.squareAttackedBy(rank,5,this.opColor(color))
           && !this.squareAttackedBy(rank,6,this.opColor(color))) {
          add(rank,6);
        }
        // uzun rok
        if(canCastleQueen && this.pieceAt(rank,3)==="" && this.pieceAt(rank,2)==="" && this.pieceAt(rank,1)===""
           && !this.squareAttackedBy(rank,4,this.opColor(color))
           && !this.squareAttackedBy(rank,3,this.opColor(color))
           && !this.squareAttackedBy(rank,2,this.opColor(color))) {
          add(rank,2);
        }
      }
    }

    return mvs;
  }

  opColor(c){return c==='w'?'b':'w';}

  addSliding(r,f,color,mvs,dirs) {
    for(let d of dirs) {
      let nr=r, nf=f;
      while(true) {
        nr+=d[0]; nf+=d[1];
        if(!this.isOnBoard(nr,nf)) break;
        let tp=this.pieceAt(nr,nf);
        if(tp===""){
          mvs.push({fr:r,ff:f,tr:nr,tf:nf});
        } else {
          if(this.colorOf(tp)!==color) mvs.push({fr:r,ff:f,tr:nr,tf:nf});
          break;
        }
      }
    }
  }

  generateMoves(color) {
    // pseudo hamleler
    let moves=[];
    for(let r=0;r<8;r++){
      for(let f=0;f<8;f++){
        let p=this.board[r][f];
        if(p!==""&&this.colorOf(p)===color){
          let pmoves=this.pseudoMoves(r,f,p);
          // En passant ekleme
          // Promotion handle: pseudoMoves normal
          // Rok handle: pseudoMoves krala ekli
          // En son ep removals ve castling rook moves handle makeMove/undoMove
          for(let mv of pmoves) {
            let fromSq=this.coordsToSquare(r,f);
            let toSq=this.coordsToSquare(mv.tr,mv.tf);
            let moveObj={from:fromSq,to:toSq};

            // Promotion
            if(p.toLowerCase()==='p' && (mv.tr===0 || mv.tr===7)){
              moveObj.promotion='q'; // otomatik vezir
            }

            moves.push(moveObj);
          }
        }
      }
    }
    return moves;
  }

  coordsToSquare(r,f){
    return String.fromCharCode("a".charCodeAt(0)+f)+(8-r);
  }

  squareToCoords(sq){
    let f=sq.charCodeAt(0)-"a".charCodeAt(0);
    let r=8 - parseInt(sq.charAt(1));
    return {r,f};
  }

  // makeMove: moveObj {from,to,promotion?}
  // handle castling, en passant
  makeMove(m) {
    this.history=this.history||[];
    let state={
      board: this.board.map(row=>row.slice()),
      activeColor:this.activeColor,
      castlingRights:this.castlingRights,
      enPassantTarget:this.enPassantTarget,
      halfmoveClock:this.halfmoveClock,
      fullmoveNumber:this.fullmoveNumber
    };
    this.history.push(state);

    let from=this.squareToCoords(m.from);
    let to=this.squareToCoords(m.to);
    let piece=this.board[from.r][from.f];
    let target=this.board[to.r][to.f];
    let color=this.colorOf(piece);

    // update halfmove clock
    if(piece.toLowerCase()==='p' || target!=="") {
      this.halfmoveClock=0;
    } else {
      this.halfmoveClock++;
    }

    // move piece
    this.board[to.r][to.f]=m.promotion||piece;
    this.board[from.r][from.f]="";

    // en passant
    if(piece.toLowerCase()==='p'){
      if(Math.abs(to.r - from.r)===2) {
        // double push
        this.enPassantTarget=String.fromCharCode("a".charCodeAt(0)+from.f)+(8 - ((from.r+to.r)/2));
      } else {
        if(this.enPassantTarget && to.f===this.squareToCoords(this.enPassantTarget).f && to.r===this.squareToCoords(this.enPassantTarget).r) {
          // en passant capture
          let dir=color==='w'?1:-1;
          this.board[to.r+dir][to.f]="";
        }
        this.enPassantTarget=null;
      }
    } else {
      this.enPassantTarget=null;
    }

    // castling
    if(piece.toLowerCase()==='k') {
      let rank=color==='w'?7:0;
      if(from.f===4 && to.f===6 && from.r===rank && to.r===rank) {
        // short castle
        this.board[rank][5]=this.board[rank][7];
        this.board[rank][7]="";
      }
      if(from.f===4 && to.f===2 && from.r===rank && to.r===rank) {
        // long castle
        this.board[rank][3]=this.board[rank][0];
        this.board[rank][0]="";
      }
      // castling rights kayıp
      if(color==='w'){
        this.castlingRights=this.castlingRights.replace('K','').replace('Q','');
      } else {
        this.castlingRights=this.castlingRights.replace('k','').replace('q','');
      }
    }

    // Rook moved?
    if(piece.toLowerCase()==='r') {
      let rank=color==='w'?7:0;
      if(from.r===rank && from.f===0) {
        // a rook
        if(color==='w') this.castlingRights=this.castlingRights.replace('Q','');
        else this.castlingRights=this.castlingRights.replace('q','');
      }
      if(from.r===rank && from.f===7) {
        // h rook
        if(color==='w') this.castlingRights=this.castlingRights.replace('K','');
        else this.castlingRights=this.castlingRights.replace('k','');
      }
    }

    // Rook captured?
    if(target!=="") {
      // maybe captured rook that affects castling
      let wRank=7,bRank=0;
      // if captured a rook from initial squares
      if(to.r===7 && to.f===0) this.castlingRights=this.castlingRights.replace('Q','');
      if(to.r===7 && to.f===7) this.castlingRights=this.castlingRights.replace('K','');
      if(to.r===0 && to.f===0) this.castlingRights=this.castlingRights.replace('q','');
      if(to.r===0 && to.f===7) this.castlingRights=this.castlingRights.replace('k','');
    }

    // King moved?
    if(piece.toLowerCase()==='k') {
      // no castling for that color
      if(color==='w') {
        this.castlingRights=this.castlingRights.replace('K','').replace('Q','');
      } else {
        this.castlingRights=this.castlingRights.replace('k','').replace('q','');
      }
    }

    // switch turn
    this.activeColor = this.activeColor==='w'?'b':'w';
    if(this.activeColor==='w') this.fullmoveNumber++;
  }

  undoMove() {
    let state = this.history.pop();
    this.board=state.board;
    this.activeColor=state.activeColor;
    this.castlingRights=state.castlingRights;
    this.enPassantTarget=state.enPassantTarget;
    this.halfmoveClock=state.halfmoveClock;
    this.fullmoveNumber=state.fullmoveNumber;
  }
  
  validate_move(m) {
    let moves = this.getAllValidMovesForTurn();
    return moves.some(mv => mv.from === m.from && mv.to === m.to);
  }

// Burada ... yerine önceki paylaşımlarda tam satranç kurallı chess.js kodundaki fonksiyonlar aynen yerleştirilecek.
// Burada yer kısıtlı olduğu için tüm fonksiyonları tekrar yazmıyorum, lütfen önceki cevaptaki tam `chess.js`
// kodunu buraya kopyalayın. Aynı mantık. Tüm satranç kuralları uygulanmıştır.
}

// Match/bot logic
io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  socket.hasMatched = false;
  socket.isBotGame = false;

  // Oyuncu oyuna girdi, başka oyuncu var mı kontrol
  if (waitingPlayer) {
    // Eşleştir
    matchPlayers(waitingPlayer, socket);
    waitingPlayer = null;
  } else {
    // Bekleyen oyuncu yok, bu oyuncuyu beklemeye al
    waitingPlayer = socket;
    socket.matchTimeout = setTimeout(() => {
      if (!socket.hasMatched && !socket.isBotGame) {
        // bot iste
        assignBot(socket);
      }
    }, 30000);
  }

  socket.on('move', (move) => {
    if (socket.gameId && games[socket.gameId]) {
      let g = games[socket.gameId];
      if (g.chess.turn() === socket.color) {
        let result = g.chess.move(move);
        if (result) {
          if (socket.opponent==='bot') {
            setTimeout(()=>botMove(socket.gameId),2000);
          } else {
            if(socket.opponent && socket.opponent.id) {
              io.to(socket.opponent.id).emit('move', move);
            }
          }
          if (g.chess.game_over()) {
            endGame(socket, g);
          }
        }
      }
    }
  });

  socket.on('claimVictory', (data) => {
    let query = "UPDATE users SET points = points + 100 WHERE user_id = $1";
    client.query(query, [socket.id], (err) => {
      if (err) {
        console.error(err);
      }
    });
  });

  socket.on('botRequest', () => {
    if (!socket.hasMatched && !socket.isBotGame) {
      assignBot(socket);
    }
  });

  socket.on('disconnect', () => {
    console.log('Bir kullanıcı ayrıldı:', socket.id);
    if (waitingPlayer===socket) {
      waitingPlayer=null;
    }

    if (socket.opponent && socket.opponent!=='bot') {
      io.to(socket.opponent.id).emit("opponentLeft");
      socket.opponent.opponent=null;
    }
  });
});

function matchPlayers(player1, player2) {
  player1.hasMatched = true;
  player2.hasMatched = true;

  // Rastgele sayılar şimdi üretelim
  let player1Number = Math.floor(Math.random()*1000);
  let player2Number = Math.floor(Math.random()*1000);
  while(player1Number===player2Number) {
    player1Number=Math.floor(Math.random()*1000);
    player2Number=Math.floor(Math.random()*1000);
  }

  let colorAssignment = player1Number>player2Number?["white","black"]:["black","white"];

  player1.color = colorAssignment[0];
  player2.color = colorAssignment[1];

  player1.emit("assignColor", { color: player1.color });
  player2.emit("assignColor", { color: player2.color });

  player1.opponent = player2;
  player2.opponent = player1;

  let gameId="game_"+player1.id+"_"+player2.id;
  games[gameId]={chess:new ServerChessLogic()};

  player1.gameId=gameId;
  player2.gameId=gameId;
}

function assignBot(socket) {
  socket.hasMatched=true;
  socket.isBotGame=true;

  let playerNumber=Math.floor(Math.random()*1000);
  let botNumber=Math.floor(Math.random()*1000);
  while(botNumber===playerNumber) {
    botNumber=Math.floor(Math.random()*1000);
  }

  let colorAssignment=playerNumber>botNumber?["white","black"]:["black","white"];
  socket.color=colorAssignment[0];
  socket.emit("assignColor",{color:socket.color});
  socket.opponent='bot';

  let gameId="game_"+socket.id+"_bot";
  games[gameId]={chess:new ServerChessLogic()};
  socket.gameId=gameId;

  if(games[gameId].chess.turn()!==socket.color) {
    setTimeout(()=>botMove(gameId),2000);
  }
}

function botMove(gameId) {
  let g=games[gameId];
  if(!g)return;
  if(g.chess.game_over())return;
  let moves=g.chess.getAllValidMovesForTurn();
  if(moves.length===0)return;
  let move=moves[Math.floor(Math.random()*moves.length)];
  let result=g.chess.move(move);
  if(result) {
    let playerSocketId=gameId.split('_')[1];
    let playerSocket=Array.from(io.sockets.sockets.values()).find(s=>s.id===playerSocketId);
    if(playerSocket) {
      playerSocket.emit('move',move);
    }
    if(g.chess.game_over() && playerSocket) {
      endGame(playerSocket,g);
    } else {
      if(playerSocket && g.chess.turn()!==playerSocket.color) {
        setTimeout(()=>botMove(gameId),2000);
      }
    }
  }
}

function endGame(socket,g) {
  let moves=g.chess.getAllValidMovesForTurn();
  if(moves.length>0)return; // Not ended
  let color=g.chess.turn();
  let inCheck=g.chess.inCheck(color);
  let loserColor=inCheck?color:null;
  let winnerColor=loserColor?(loserColor==='w'?'b':'w'):null;

  if(inCheck) {
    // mat
    if(socket.color===winnerColor) {
      socket.emit("gameOver",{winner:winnerColor});
      if(socket.opponent!=='bot' && socket.opponent) {
        socket.opponent.emit("gameOver",{winner:winnerColor});
      }
    } else {
      socket.emit("gameOver",{winner:winnerColor});
      if(socket.opponent!=='bot' && socket.opponent) {
        socket.opponent.emit("gameOver",{winner:winnerColor});
      }
    }
  } else {
    // pat
    socket.emit("gameOver",{winner:null});
    if(socket.opponent!=='bot' && socket.opponent) {
      socket.opponent.emit("gameOver",{winner:null});
    }
  }
}

server.listen(port, () => {
  console.log('Sunucu çalışıyor: ' + port);
});
