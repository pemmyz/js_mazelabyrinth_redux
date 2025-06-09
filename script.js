// ============================ Utility Functions ============================
function toRadian(deg) {
  return deg * Math.PI / 180;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerpAngle(a, b, t) {
  // Handle angle wrapping for smoother lerp
  const delta = b - a;
  if (delta > 180) {
    b -= 360;
  } else if (delta < -180) {
    b += 360;
  }
  return a + (b - a) * t;
}


// ============================ Shader Sources ============================
const vsSource = `
  attribute vec3 aPosition;
  attribute vec2 aTexCoord;
  uniform mat4 uProjection;
  uniform mat4 uView;
  uniform mat4 uModel;
  varying vec2 vTexCoord;
  void main(void) {
      gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
      vTexCoord = aTexCoord;
  }
`;
const fsSource = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D uTexture;
  void main(void) {
      gl_FragColor = texture2D(uTexture, vTexCoord);
  }
`;

// ============================ Shader Utility Functions ============================
function loadShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    alert("Error compiling shader: " + gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
function initShaderProgram(gl, vsSource, fsSource) {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const shaderProgram = gl.createProgram();
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);
  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    alert("Error linking shader program: " + gl.getProgramInfoLog(shaderProgram));
    return null;
  }
  return shaderProgram;
}

// ============================ Texture Loader ============================
function loadTexture(gl, url) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  // Temporary 1x1 pixel (grey) until image loads.
  const level = 0, internalFormat = gl.RGB, width = 1, height = 1, border = 0,
        srcFormat = gl.RGB, srcType = gl.UNSIGNED_BYTE;
  const pixel = new Uint8Array([128, 128, 128]); // Grey pixel
  gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height,
                border, srcFormat, srcType, pixel);
  const image = new Image();
  image.onload = function() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
                  srcFormat, srcType, image);
    if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
      gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); // Added for consistency
    }
  };
  image.onerror = function() {
    console.error("Failed to load texture: " + url);
    // Optionally fallback to the grey pixel texture permanently
     gl.bindTexture(gl.TEXTURE_2D, texture);
     gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height,
                   border, srcFormat, srcType, pixel);
     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
     gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  };
  image.src = url;
  return texture;
}
function isPowerOf2(value) {
  return (value & (value - 1)) === 0;
}

// ============================ Maze Generation Code ============================
class Rect {
  constructor(x, y, w, h) {
    this.x1 = x;
    this.y1 = y;
    this.x2 = x + w;
    this.y2 = y + h;
    this.center = [Math.floor((this.x1 + this.x2) / 2), Math.floor((this.y1 + this.y2) / 2)];
  }
  intersect(other) {
    // Add a small buffer to prevent rooms touching exactly
    return (this.x1 < other.x2 + 1 && this.x2 > other.x1 - 1 &&
            this.y1 < other.y2 + 1 && this.y2 > other.y1 - 1);
  }
}
function createMap(width, height, maxRooms, roomMinSize, roomMaxSize, seed) {
    // Use a simple pseudo-random number generator if seed is provided
    let rng = Math.random;
    if (seed !== undefined) {
        console.log("Creating map with seed:", seed);
        let m_w = seed;
        let m_z = 987654321;
        rng = function() {
            m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & 0xffffffff;
            m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & 0xffffffff;
            let result = ((m_z << 16) + m_w) & 0xffffffff;
            result /= 4294967296; // Convert to [0, 1) range
            return result + 0.5; // Adjust to approximate Math.random() range slightly better for integer generation
        }
    }

    let mapGrid = [];
    for (let i = 0; i < height; i++) {
        let row = [];
        for (let j = 0; j < width; j++) {
            row.push('#'); // Start with all walls
        }
        mapGrid.push(row);
    }

    let rooms = [];
    for (let r = 0; r < maxRooms; r++) {
        let w = Math.floor(rng() * (roomMaxSize - roomMinSize + 1)) + roomMinSize;
        let h = Math.floor(rng() * (roomMaxSize - roomMinSize + 1)) + roomMinSize;
        // Ensure coordinates are odd for better corridor connection potential if using certain algorithms
        let x = Math.floor(rng() * ((width - w - 1) / 2)) * 2 + 1;
        let y = Math.floor(rng() * ((height - h - 1) / 2)) * 2 + 1;

        let newRoom = new Rect(x, y, w, h);

        // Check for intersections with existing rooms
        let failed = false;
        for (let otherRoom of rooms) {
            if (newRoom.intersect(otherRoom)) {
                failed = true;
                break;
            }
        }

        if (!failed) {
            // Carve out the room
            for (let i = newRoom.y1; i < newRoom.y2; i++) {
                for (let j = newRoom.x1; j < newRoom.x2; j++) {
                     // Make sure we don't carve outside map boundaries
                     if (i >= 0 && i < height && j >= 0 && j < width) {
                        mapGrid[i][j] = ' ';
                     }
                }
            }

            // Connect to the previous room (if exists)
            if (rooms.length > 0) {
                let prev = rooms[rooms.length - 1];
                let [prevX, prevY] = prev.center;
                let [newX, newY] = newRoom.center;

                // Ensure centers are within bounds
                prevX = Math.max(0, Math.min(width - 1, prevX));
                prevY = Math.max(0, Math.min(height - 1, prevY));
                newX = Math.max(0, Math.min(width - 1, newX));
                newY = Math.max(0, Math.min(height - 1, newY));

                if (rng() < 0.5) { // Horizontal then vertical tunnel
                    // Carve horizontal tunnel
                    for (let xCorr = Math.min(prevX, newX); xCorr <= Math.max(prevX, newX); xCorr++) {
                         if (prevY >= 0 && prevY < height && xCorr >= 0 && xCorr < width) {
                            mapGrid[prevY][xCorr] = ' ';
                            // Carve adjacent cells if they are walls, for wider tunnels
                            if (prevY > 0 && mapGrid[prevY-1][xCorr] === '#') mapGrid[prevY-1][xCorr] = ' ';
                            if (prevY < height - 1 && mapGrid[prevY+1][xCorr] === '#') mapGrid[prevY+1][xCorr] = ' ';
                         }
                    }
                    // Carve vertical tunnel
                    for (let yCorr = Math.min(prevY, newY); yCorr <= Math.max(prevY, newY); yCorr++) {
                         if (yCorr >= 0 && yCorr < height && newX >= 0 && newX < width) {
                            mapGrid[yCorr][newX] = ' ';
                            // Carve adjacent cells if they are walls, for wider tunnels
                            if (newX > 0 && mapGrid[yCorr][newX-1] === '#') mapGrid[yCorr][newX-1] = ' ';
                            if (newX < width - 1 && mapGrid[yCorr][newX+1] === '#') mapGrid[yCorr][newX+1] = ' ';
                         }
                    }
                } else { // Vertical then horizontal tunnel
                   // Carve vertical tunnel
                    for (let yCorr = Math.min(prevY, newY); yCorr <= Math.max(prevY, newY); yCorr++) {
                         if (yCorr >= 0 && yCorr < height && prevX >= 0 && prevX < width) {
                            mapGrid[yCorr][prevX] = ' ';
                            if (prevX > 0 && mapGrid[yCorr][prevX-1] === '#') mapGrid[yCorr][prevX-1] = ' ';
                            if (prevX < width - 1 && mapGrid[yCorr][prevX+1] === '#') mapGrid[yCorr][prevX+1] = ' ';
                         }
                    }
                   // Carve horizontal tunnel
                    for (let xCorr = Math.min(prevX, newX); xCorr <= Math.max(prevX, newX); xCorr++) {
                         if (newY >= 0 && newY < height && xCorr >= 0 && xCorr < width) {
                            mapGrid[newY][xCorr] = ' ';
                            if (newY > 0 && mapGrid[newY-1][xCorr] === '#') mapGrid[newY-1][xCorr] = ' ';
                            if (newY < height - 1 && mapGrid[newY+1][xCorr] === '#') mapGrid[newY+1][xCorr] = ' ';
                         }
                    }
                }
            }
            rooms.push(newRoom);
        }
    }

  // Place an exit 'E' in the last room created, preferably near a corner but ensuring it's accessible
  if (rooms.length > 0) {
    let lastRoom = rooms[rooms.length - 1];
    let exitX, exitY;
    let foundExitPos = false;
    // Try corners first, check if adjacent cell is open space
    const potentialExits = [
        [lastRoom.x1 + 1, lastRoom.y1 + 1], [lastRoom.x2 - 2, lastRoom.y1 + 1],
        [lastRoom.x1 + 1, lastRoom.y2 - 2], [lastRoom.x2 - 2, lastRoom.y2 - 2],
        [lastRoom.center[0], lastRoom.y1 + 1], [lastRoom.center[0], lastRoom.y2 - 2],
        [lastRoom.x1 + 1, lastRoom.center[1]], [lastRoom.x2 - 2, lastRoom.center[1]]
    ];
    for (let pos of potentialExits) {
        let px = pos[0], py = pos[1];
        // Check bounds and if it's inside the room space
        if (px > lastRoom.x1 && px < lastRoom.x2 -1 && py > lastRoom.y1 && py < lastRoom.y2 - 1 && mapGrid[py][px] === ' ') {
             // Check neighbours for path out
             const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
             for(let d of dirs) {
                 let nx = px + d[0], ny = py + d[1];
                 if (nx >= 0 && nx < width && ny >= 0 && ny < height && mapGrid[ny][nx] === ' ') {
                     exitX = px;
                     exitY = py;
                     foundExitPos = true;
                     break;
                 }
             }
        }
        if (foundExitPos) break;
    }

    // If no corner worked, place it at the center (ensure center is valid)
    if (!foundExitPos) {
       exitX = Math.max(1, Math.min(width - 2, lastRoom.center[0]));
       exitY = Math.max(1, Math.min(height - 2, lastRoom.center[1]));
       // Ensure the center itself is actually floor
       if(mapGrid[exitY][exitX] !== ' ') {
           // Search outwards from center for a floor tile within the room
           searchLoop:
           for(let r=1; r<Math.max(lastRoom.x2-lastRoom.x1, lastRoom.y2-lastRoom.y1); ++r) {
               for(let dy = -r; dy <= r; ++dy) {
                   for(let dx = -r; dx <= r; ++dx) {
                       if(Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // Only check perimeter of square
                       let checkX = exitX + dx;
                       let checkY = exitY + dy;
                       if (checkX >= lastRoom.x1 && checkX < lastRoom.x2 && checkY >= lastRoom.y1 && checkY < lastRoom.y2 && mapGrid[checkY][checkX] === ' ') {
                           exitX = checkX;
                           exitY = checkY;
                           break searchLoop;
                       }
                   }
               }
           }
       }
    }
     // Final check to ensure the chosen exit point is valid
     if (exitY >= 0 && exitY < height && exitX >= 0 && exitX < width && mapGrid[exitY][exitX] === ' ') {
         mapGrid[exitY][exitX] = 'E';
     } else {
         console.warn("Failed to place exit 'E' in a valid location. Placing at room center fallback.");
         // Fallback: Place at center even if it overwrites a wall (should be rare)
         exitX = Math.max(1, Math.min(width - 2, lastRoom.center[0]));
         exitY = Math.max(1, Math.min(height - 2, lastRoom.center[1]));
          if (exitY >= 0 && exitY < height && exitX >= 0 && exitX < width) {
            mapGrid[exitY][exitX] = 'E';
          } else {
              console.error("Catastrophic failure placing exit.");
          }
     }
  } else {
      console.warn("No rooms generated, cannot place exit.");
      // Optionally place an exit somewhere random if no rooms?
  }


    // Convert isolated wall cells 'B' (optional, can remove if not desired)
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            if (mapGrid[i][j] === '#') {
                let adjacentOpen = false;
                let dirs = [[-1,0], [1,0], [0,-1], [0,1], [-1,-1], [-1,1], [1,-1], [1,1]]; // Check diagonals too
                for (let d of dirs) {
                    let nx = j + d[0], ny = i + d[1];
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        if (mapGrid[ny][nx] !== '#') { // Any non-wall is considered "open"
                            adjacentOpen = true;
                            break;
                        }
                    }
                }
                if (!adjacentOpen) {
                    mapGrid[i][j] = 'B'; // 'B' for Bulk/internal wall block
                }
            }
        }
    }

    let maze = mapGrid.map(row => row.join(''));
    return { maze: maze, rooms: rooms };
}

// ============================ Build Maze Geometry ============================
function buildMazeGeometry(maze) {
  let floorVerts = [];
  let ceilingVerts = [];
  let wallBrickVerts = [];
  let wallExitVerts = [];
  const rows = maze.length;
  const cols = maze[0].length;
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      let cell = maze[z][x];

      // Only draw floor/ceiling for non-wall cells
      if (cell !== '#' && cell !== 'B') {
          // Floor (y=0)
          floorVerts.push(
            x, 0.0, z,       0.0, 0.0,
            x+1, 0.0, z,     1.0, 0.0,
            x+1, 0.0, z+1,   1.0, 1.0,
            x, 0.0, z,       0.0, 0.0,
            x+1, 0.0, z+1,   1.0, 1.0,
            x, 0.0, z+1,     0.0, 1.0
          );
          // Ceiling (y=1)
          ceilingVerts.push(
            x, 1.0, z+1,     0.0, 1.0, // Flipped UVs for ceiling texture orientation
            x+1, 1.0, z+1,   1.0, 1.0,
            x+1, 1.0, z,     1.0, 0.0,
            x, 1.0, z+1,     0.0, 1.0,
            x+1, 1.0, z,     1.0, 0.0,
            x, 1.0, z,       0.0, 0.0
          );
      }


      if (cell === '#' || cell === 'B' || cell === 'E') {
        let isExit = (cell === 'E');
        let targetVerts = isExit ? wallExitVerts : wallBrickVerts;

        // North wall (-Z direction face) - draw if cell north is open space
        if (z > 0 && maze[z-1][x] !== '#' && maze[z-1][x] !== 'B') {
          targetVerts.push(
            x+1, 1.0, z,     1.0, 1.0, // Top Right
            x+1, 0.0, z,     1.0, 0.0, // Bottom Right
            x,   0.0, z,     0.0, 0.0, // Bottom Left
            x,   1.0, z,     0.0, 1.0, // Top Left
            x+1, 1.0, z,     1.0, 1.0, // Top Right
            x,   0.0, z,     0.0, 0.0  // Bottom Left
          );
        }
        // South wall (+Z direction face) - draw if cell south is open space
        if (z < rows-1 && maze[z+1][x] !== '#' && maze[z+1][x] !== 'B') {
          targetVerts.push(
            x,   1.0, z+1,   0.0, 1.0, // Top Left
            x,   0.0, z+1,   0.0, 0.0, // Bottom Left
            x+1, 0.0, z+1,   1.0, 0.0, // Bottom Right
            x+1, 1.0, z+1,   1.0, 1.0, // Top Right
            x,   1.0, z+1,   0.0, 1.0, // Top Left
            x+1, 0.0, z+1,   1.0, 0.0  // Bottom Right
          );
        }
        // West wall (-X direction face) - draw if cell west is open space
        if (x > 0 && maze[z][x-1] !== '#' && maze[z][x-1] !== 'B') {
           targetVerts.push(
            x, 1.0, z,       0.0, 1.0, // Top Left (back)
            x, 0.0, z,       0.0, 0.0, // Bottom Left (back)
            x, 0.0, z+1,     1.0, 0.0, // Bottom Left (front)
            x, 1.0, z+1,     1.0, 1.0, // Top Left (front)
            x, 1.0, z,       0.0, 1.0, // Top Left (back)
            x, 0.0, z+1,     1.0, 0.0  // Bottom Left (front)
          );
        }
        // East wall (+X direction face) - draw if cell east is open space
        if (x < cols-1 && maze[z][x+1] !== '#' && maze[z][x+1] !== 'B') {
          targetVerts.push(
            x+1, 1.0, z+1,   1.0, 1.0, // Top Right (front)
            x+1, 0.0, z+1,   1.0, 0.0, // Bottom Right (front)
            x+1, 0.0, z,     0.0, 0.0, // Bottom Right (back)
            x+1, 1.0, z,     0.0, 1.0, // Top Right (back)
            x+1, 1.0, z+1,   1.0, 1.0, // Top Right (front)
            x+1, 0.0, z,     0.0, 0.0  // Bottom Right (back)
          );
        }
      }
    }
  }
  return {
    floor: new Float32Array(floorVerts),
    ceiling: new Float32Array(ceilingVerts),
    wallBrick: new Float32Array(wallBrickVerts),
    wallExit: new Float32Array(wallExitVerts)
  };
}


// ============================ Global Variables ============================
let gl, shaderProgram;
let attribLocations, uniformLocations;
let buffers = {};
let textures = {};
let mazeData, geometry;
let discovered = []; // For map visibility
let playerPos = [2.5, 0.0, 2.5]; // Initial placeholder
let playerAngle = 0; // Facing positive Z
const mazeWidth = 100, mazeHeight = 100, maxRooms = 40, roomMinSize = 5, roomMaxSize = 9; // Adjusted maze params
let fullMapVisible = false;
let lastFrameTime = 0; // For delta time calculation

// State for help menu and movement styles
let helpVisible = false;
// NEW: Separated player and bot movement styles
let manualMoveStyle = 'free';   // Player style: 'free' or 'step'
let botMoveStyle = 'smooth';      // Bot visual style: 'smooth' or 'block'

// Animation variables for smooth movement.
let animatingTranslation = false;
let translationStart = 0;
const translationDuration = 150; // milliseconds for movement step (bot or player block move)
let startPos = [0, 0, 0];
let targetPos = [0, 0, 0];

let animatingRotation = false;
let rotationStart = 0;
const rotationDuration = 120; // milliseconds for rotation
let startAngle = 0;
let targetAngle = 0;

// Variables for map dragging.
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;

// ----------- Bot Mode Global Variables -----------
let botMode = false;
let botPath = [];
let botPathIndex = 0;
let selectedAlgorithm = "explore"; // Default to explore for auto-start

// ----------- Auto-Start Bot Variables -----------
let lastManualInputTime = 0;
const countdownDuration = 7000; // milliseconds (7 seconds)
let autoStarted = false;

// ----------- Auto Map Toggling for Bot Mode -----------
let autoMapState = 'IDLE'; // 'IDLE', 'INITIAL_WAIT', 'MAP_OPEN', 'MAP_CLOSED_WAIT'
let autoMapTimer = 0;
const autoMapInitialWait = 3000; // 3 seconds before first open
const autoMapOpenDuration = 5000;  // 5 seconds map is visible
const autoMapClosedWaitDuration = 6000; // 6 seconds map is hidden

// ----------- Continuous Movement State -----------
const keysDown = {};
window.addEventListener("keydown", e => { keysDown[e.key.toLowerCase()] = true; onKeyDown(e); }); // Trigger original onKeyDown too
window.addEventListener("keyup",   e => { keysDown[e.key.toLowerCase()] = false; });


// ============================ Pathfinding Helper Functions ============================
// Returns a string key for coordinate objects.
function coordKey(cell) {
  return cell.x + "," + cell.y;
}
// Return neighbors (cells with floor ' ' or exit 'E')
function getNeighbors(cell, maze) {
  let nbrs = [];
  const directions = [
    {x: 1, y: 0}, {x: -1, y: 0}, {x: 0, y: 1}, {x: 0, y: -1}
  ];
  for (let d of directions) {
    let nx = cell.x + d.x, ny = cell.y + d.y;
    if (ny >= 0 && ny < maze.length && nx >= 0 && nx < maze[0].length) {
      let c = maze[ny].charAt(nx);
      if (c === ' ' || c === 'E') {
        nbrs.push({x: nx, y: ny});
      }
    }
  }
  return nbrs;
}
// BFS pathfinding
function bfsPath(start, goal, maze) {
  let queue = [{cell: start, path: [start]}]; // Store path with each node
  let visited = new Set();
  visited.add(coordKey(start));

  while (queue.length > 0) {
    let currentItem = queue.shift();
    let current = currentItem.cell;
    let path = currentItem.path;

    if (current.x === goal.x && current.y === goal.y) {
      return path; // Return the found path
    }

    for (let n of getNeighbors(current, maze)) {
      if (!visited.has(coordKey(n))) {
        visited.add(coordKey(n));
        let newPath = path.concat([n]); // Create new path array
        queue.push({cell: n, path: newPath});
      }
    }
  }
  return []; // No path found
}

// DFS pathfinding (iterative version)
function dfsPath(start, goal, maze) {
    let stack = [{ cell: start, path: [start] }]; // Use a stack and store path
    let visited = new Set();
    visited.add(coordKey(start));

    while (stack.length > 0) {
        let currentItem = stack.pop(); // LIFO for DFS
        let current = currentItem.cell;
        let path = currentItem.path;

        if (current.x === goal.x && current.y === goal.y) {
            return path; // Path found
        }

        // Explore neighbors in a consistent (e.g., reversed) order for predictability
        let neighbors = getNeighbors(current, maze).reverse();
        for (let n of neighbors) {
            if (!visited.has(coordKey(n))) {
                visited.add(coordKey(n));
                let newPath = path.concat([n]);
                stack.push({ cell: n, path: newPath });
            }
        }
    }
    return []; // No path found
}

// A* pathfinding
function heuristic(a, b) { // Manhattan distance
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
function astarPath(start, goal, maze) {
  // Priority queue implementation (simple array sort for smaller mazes)
  let frontier = [{cell: start, priority: 0}];
  let cameFrom = {};
  cameFrom[coordKey(start)] = null;
  let costSoFar = {};
  costSoFar[coordKey(start)] = 0;

  while (frontier.length > 0) {
    // Sort frontier by priority (lowest first) - inefficient for large maps, use min-heap ideally
    frontier.sort((a, b) => a.priority - b.priority);
    let currentItem = frontier.shift();
    let current = currentItem.cell;

    if (current.x === goal.x && current.y === goal.y) {
      // Reconstruct path
      let path = [];
      let temp = goal;
      while (temp !== null) {
        path.push(temp);
        temp = cameFrom[coordKey(temp)];
      }
      return path.reverse(); // Path goes from start to goal
    }

    for (let n of getNeighbors(current, maze)) {
      let newCost = costSoFar[coordKey(current)] + 1; // Assuming cost of 1 per step
      let nKey = coordKey(n);
      if (!(nKey in costSoFar) || newCost < costSoFar[nKey]) {
        costSoFar[nKey] = newCost;
        let priority = newCost + heuristic(n, goal);
        frontier.push({cell: n, priority: priority});
        cameFrom[nKey] = current;
      }
    }
  }
  return []; // No path found
}

// Helper: Determine if cell is inside a room (rooms have x1, y1, x2, y2)
function cellInRoom(cell, room) {
    // Use >= for start, < for end to match room carving logic
  return cell.x >= room.x1 && cell.x < room.x2 && cell.y >= room.y1 && cell.y < room.y2;
}

// Explore mode pathfinding: Visit *all* room centers, ending at the exit.
function explorePath(start, goal, maze, rooms) {
    let roomCenters = rooms.map(room => ({ x: room.center[0], y: room.center[1] }));
    // Ensure goal is reachable, add it as a target if not already a center
    if (!roomCenters.some(c => c.x === goal.x && c.y === goal.y)) {
         // Add goal if it's not already a center - check if it's walkable first
         if (maze[goal.y].charAt(goal.x) === ' ' || maze[goal.y].charAt(goal.x) === 'E') {
             roomCenters.push(goal);
         } else {
             console.warn("Explore Goal is inside a wall?");
             // Find nearest walkable tile to goal and add that instead? Or just proceed without explicit goal add.
         }
    }

    // Remove duplicate centers (if multiple rooms share a center grid cell)
    let uniqueCenters = [];
    let seenKeys = new Set();
    for (let center of roomCenters) {
        let key = coordKey(center);
        if (!seenKeys.has(key)) {
            uniqueCenters.push(center);
            seenKeys.add(key);
        }
    }
    roomCenters = uniqueCenters;


    let overallPath = [];
    let currentPos = start;
    let visitedCenters = new Set(); // Track visited center *cells*

    while (roomCenters.length > 0) {
        // Find the closest unvisited room center
        roomCenters.sort((a, b) => heuristic(currentPos, a) - heuristic(currentPos, b));
        let targetCenter = roomCenters.shift(); // Get the closest one

        // Find path segment to this center
        let segment = bfsPath(currentPos, targetCenter, maze); // Using BFS for shortest paths between centers

        if (segment.length > 0) {
             // Append segment (avoid duplicating the connection point)
             if (overallPath.length > 0 && segment.length > 1 &&
                coordKey(overallPath[overallPath.length - 1]) === coordKey(segment[0])) {
                 overallPath = overallPath.concat(segment.slice(1));
             } else {
                 overallPath = overallPath.concat(segment);
             }
             currentPos = targetCenter; // Update current position
        } else {
            console.warn("Explore mode: Could not find path segment to center", targetCenter);
            // Could skip this center or try A* etc. For now, just skip.
        }
    }

     // Finally, ensure path goes to the actual goal cell if it wasn't the last center visited
     if (coordKey(currentPos) !== coordKey(goal)) {
        let finalSegment = bfsPath(currentPos, goal, maze);
        if (finalSegment.length > 0) {
            if (overallPath.length > 0 && finalSegment.length > 1 &&
                coordKey(overallPath[overallPath.length - 1]) === coordKey(finalSegment[0])) {
                overallPath = overallPath.concat(finalSegment.slice(1));
            } else {
                 overallPath = overallPath.concat(finalSegment);
            }
        } else {
             console.warn("Explore mode: Could not find final path segment to goal", goal);
        }
     }

    return overallPath;
}

// Compute bot path based on current algorithm selection.
function computeBotPath() {
  let exitCell = null;
  for (let i = 0; i < mazeData.maze.length; i++) {
    for (let j = 0; j < mazeData.maze[i].length; j++) {
      if (mazeData.maze[i].charAt(j) === 'E') {
        exitCell = { x: j, y: i };
        break;
      }
    }
    if (exitCell !== null) break;
  }

  if (!exitCell) {
    console.error("Cannot compute bot path: No exit 'E' found in the maze!");
    botPath = [];
    botMode = false; // Turn off bot mode if no exit
    return;
  }

  let start = { x: Math.floor(playerPos[0]), y: Math.floor(playerPos[2]) };

  // Ensure start position is valid (not inside a wall)
  if (mazeData.maze[start.y].charAt(start.x) === '#' || mazeData.maze[start.y].charAt(start.x) === 'B') {
      console.warn("Bot start position is inside a wall. Trying neighbors...");
      let neighbors = getNeighbors(start, mazeData.maze);
      if (neighbors.length > 0) {
          start = neighbors[0]; // Move to the first valid neighbor
          console.log("Adjusted bot start position to:", start);
      } else {
          console.error("Cannot compute bot path: Start position and neighbors are invalid!");
          botPath = [];
          botMode = false;
          return;
      }
  }


  console.log(`Computing bot path from (${start.x}, ${start.y}) to (${exitCell.x}, ${exitCell.y}) using ${selectedAlgorithm.toUpperCase()}`);

  let startTime = performance.now();
  switch (selectedAlgorithm) {
    case "bfs":
      botPath = bfsPath(start, exitCell, mazeData.maze);
      break;
    case "dfs":
      botPath = dfsPath(start, exitCell, mazeData.maze);
      break;
    case "astar":
      botPath = astarPath(start, exitCell, mazeData.maze);
      break;
    case "explore":
      botPath = explorePath(start, exitCell, mazeData.maze, mazeData.rooms);
      break;
    default: // Fallback to BFS
      console.warn("Unknown algorithm selected, defaulting to BFS.");
      selectedAlgorithm = "bfs";
      botPath = bfsPath(start, exitCell, mazeData.maze);
  }
  let endTime = performance.now();
  console.log(`Path computation took ${(endTime - startTime).toFixed(2)} ms.`);

  if (botPath.length === 0) {
      console.error(`Pathfinding (${selectedAlgorithm.toUpperCase()}) failed to find a path!`);
      // Possibly try another algorithm as a fallback? Or just stop the bot.
      botMode = false;
  } else {
      console.log("New bot path computed, length:", botPath.length);
      botPathIndex = 0; // Start from the beginning of the path
      // The path includes the start node, so the first move is to botPath[1]
      if (botPath.length > 1) botPathIndex = 1;
  }
}

// ============================ Collision Detection ============================
function canMove(newX, newZ) {
  const mazeRows = mazeData.maze.length;
  const mazeCols = mazeData.maze[0].length;
  // Add a small buffer to prevent getting stuck on corners
  const buffer = 0.1;
  const checkPoints = [
      { x: newX - buffer, z: newZ - buffer }, // Top-left corner
      { x: newX + buffer, z: newZ - buffer }, // Top-right corner
      { x: newX - buffer, z: newZ + buffer }, // Bottom-left corner
      { x: newX + buffer, z: newZ + buffer }, // Bottom-right corner
      { x: newX, z: newZ } // Center
  ];

  for (const point of checkPoints) {
      const gridX = Math.floor(point.x);
      const gridZ = Math.floor(point.z);

      if (gridX < 0 || gridX >= mazeCols || gridZ < 0 || gridZ >= mazeRows) {
          return false; // Cannot move outside bounds
      }
      const cell = mazeData.maze[gridZ].charAt(gridX);
      if (cell === '#' || cell === 'B') {
          return false; // Collision with a wall
      }
  }
  return true; // No collisions detected
}

// ============================ Maze Restart Function ============================
function restartGame() {
  console.log("Exit reached! Restarting game with new map.");
  let newSeed = Date.now(); // Use timestamp for a new seed each time
  mazeData = createMap(mazeWidth, mazeHeight, maxRooms, roomMinSize, roomMaxSize, newSeed);

  // Reset discovered map
  discovered = [];
  for (let i = 0; i < mazeData.maze.length; i++) {
    discovered[i] = [];
    for (let j = 0; j < mazeData.maze[i].length; j++) {
      discovered[i][j] = false;
    }
  }

  geometry = buildMazeGeometry(mazeData.maze);
  initBuffers(); // Re-initialize WebGL buffers with new geometry

  // Place player in the center of the first room
  if (mazeData.rooms && mazeData.rooms.length > 0) {
    let spawnRoom = mazeData.rooms[0];
    playerPos[0] = spawnRoom.center[0] + 0.5; // Center of the grid cell
    playerPos[2] = spawnRoom.center[1] + 0.5;
  } else {
      // Fallback if no rooms generated
      console.warn("No rooms found for spawn, placing player at default [1.5, 0, 1.5]");
      playerPos = [1.5, 0.0, 1.5];
      let foundSpawn = false;
       for (let z = 1; z < mazeHeight - 1; z++) {
           for (let x = 1; x < mazeWidth - 1; x++) {
               if (mazeData.maze[z][x] === ' ') {
                   playerPos = [x + 0.5, 0.0, z + 0.5];
                   foundSpawn = true;
                   break;
               }
           }
           if(foundSpawn) break;
       }
       if (!foundSpawn) {
            console.error("Could not find any valid spawn point in the maze!");
       }
  }

  playerAngle = 0; // Reset player orientation
  dragOffsetX = 0; // Reset map dragging
  dragOffsetY = 0;

  // Reset bot mode and auto-start state for the new maze
  botMode = false; // Turn off bot on restart
  botPath = [];
  botPathIndex = 0;
  autoStarted = false; // Reset auto-start flag
  lastManualInputTime = performance.now(); // Reset auto-start timer

  autoMapState = 'IDLE';
  autoMapTimer = 0;
  fullMapVisible = false; // Ensure map is closed on restart

  // Discover the starting cell
   updateDiscovered();
}

// ============================ Mouse Event Handlers for Dragging ============================
function onMouseDown(e) {
  // Only allow dragging if the full map is visible
  if (fullMapVisible) {
     isDragging = true;
     dragStartX = e.clientX;
     dragStartY = e.clientY;
     lastManualInputTime = performance.now();
     autoStarted = false;
     e.preventDefault(); // Prevent text selection while dragging
  }
}
function onMouseMove(e) {
  if (!isDragging || !fullMapVisible) return;
  let dx = e.clientX - dragStartX;
  let dy = e.clientY - dragStartY;
  dragOffsetX += dx;
  dragOffsetY += dy;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
}
function onMouseUp(e) {
  if (isDragging) {
    isDragging = false;
  }
}

// ============================ Movement Helper Functions ============================
const turnSpeed = 90; // Degrees per turn key press

function handleTurnLeft() {
    if (animatingRotation) return;
    animatingRotation=true;
    rotationStart=performance.now();
    startAngle=playerAngle;
    targetAngle = (playerAngle + turnSpeed + 360) % 360;
}

function handleTurnRight() {
    if (animatingRotation) return;
    animatingRotation=true;
    rotationStart=performance.now();
    startAngle=playerAngle;
    targetAngle = (playerAngle - turnSpeed + 360) % 360;
}


// ============================ Keyboard Controls (MODIFIED) ============================
function onKeyDown(e) {
  let isManualAction = false;
  let key = e.key.toLowerCase();

  // 1) Handle Toggles & Bot Keys
  switch (key) {
      case "b":
          botMode = !botMode;
          console.log("Bot mode " + (botMode ? "enabled" : "disabled"));
          if (botMode) {
              computeBotPath();
              autoMapState = 'INITIAL_WAIT';
              autoMapTimer = performance.now();
          } else {
              autoMapState = 'IDLE';
              fullMapVisible = false;
          }
          isManualAction = true;
          break;
      case "1": case "2": case "3": case "4":
          const algMap = { "1":"bfs","2":"dfs","3":"astar","4":"explore" };
          selectedAlgorithm = algMap[key];
          console.log("Algorithm selected:", selectedAlgorithm.toUpperCase());
          if (botMode) computeBotPath();
          if (!botMode) isManualAction = true;
          break;
      case "m":
          fullMapVisible = !fullMapVisible;
          if (botMode) {
              console.log("Manual map override: Disabling auto-map.");
              autoMapState = 'IDLE';
          }
          if (fullMapVisible) {
              dragOffsetX = 0;
              dragOffsetY = 0;
          }
          return;
      case "h":
          helpVisible = !helpVisible;
          return;
      // MODIFIED: 'N' now controls the BOT'S visual style
      case "n":
          botMoveStyle = (botMoveStyle === 'smooth') ? 'block' : 'smooth';
          console.log("Bot movement style set to:", botMoveStyle);
          return;
      // NEW: 'V' controls the PLAYER'S movement style
      case "v":
          manualMoveStyle = (manualMoveStyle === 'free') ? 'step' : 'free';
          console.log("Manual movement style set to:", manualMoveStyle);
          return;
  }

  // 2) Handle Manual Player Movement
  // MODIFIED: This logic now depends on manualMoveStyle being 'step'
  if (!botMode && manualMoveStyle === 'step') {
      if (['w', 's', 'arrowup', 'arrowdown'].includes(key)) {
          if (animatingTranslation || animatingRotation) return;
          
          const moveDir = (key === 'w' || key === 'arrowup') ? 1 : -1;
          
          const angleRad = toRadian(playerAngle);
          const dx = Math.sin(angleRad) * moveDir;
          const dz = Math.cos(angleRad) * moveDir;
          
          let targetGridX = Math.round(playerPos[0] - 0.5);
          let targetGridZ = Math.round(playerPos[2] - 0.5);

          if (Math.abs(dx) > Math.abs(dz)) {
              targetGridX += Math.sign(dx);
          } else {
              targetGridZ += Math.sign(dz);
          }
          
          if (targetGridZ >= 0 && targetGridZ < mazeHeight && targetGridX >= 0 && targetGridX < mazeWidth) {
              const cell = mazeData.maze[targetGridZ].charAt(targetGridX);
              if (cell !== '#' && cell !== 'B') {
                  animatingTranslation = true;
                  translationStart = performance.now();
                  startPos = [...playerPos];
                  targetPos = [targetGridX + 0.5, playerPos[1], targetGridZ + 0.5];
              }
          }
      }
  }

  // 3) Check for any key that constitutes manual input to reset the auto-bot timer
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
       isManualAction = true;
  }

  if (isManualAction) {
       lastManualInputTime = performance.now();
       autoStarted = false;
  }
}


// ============================ Update Discovered Cells ============================
function updateDiscovered() {
  const px = Math.floor(playerPos[0]);
  const pz = Math.floor(playerPos[2]);
  const viewDistance = 5; // How many cells ahead/sides to reveal

  for (let i = -viewDistance; i <= viewDistance; i++) {
    for (let j = -viewDistance; j <= viewDistance; j++) {
      let checkX = px + j;
      let checkZ = pz + i;

      if (Math.sqrt(i*i + j*j) > viewDistance + 1) continue;

      if (checkZ >= 0 && checkZ < mazeHeight && checkX >= 0 && checkX < mazeWidth) {
          let wallInWay = false;
          if (Math.abs(i)>1 || Math.abs(j)>1) {
               let midX = Math.floor(px + j * 0.5);
               let midZ = Math.floor(pz + i * 0.5);
                if (midZ >= 0 && midZ < mazeHeight && midX >= 0 && midX < mazeWidth) {
                    let midCell = mazeData.maze[midZ].charAt(midX);
                    if (midCell === '#' || midCell === 'B') {
                        wallInWay = true;
                    }
                }
          }

          if (!wallInWay) {
            discovered[checkZ][checkX] = true;
          }
      }
    }
  }
   if (pz >= 0 && pz < mazeHeight && px >= 0 && px < mazeWidth) {
       discovered[pz][px] = true;
   }
}


// ============================ Initialization ============================
function init() {
  const canvas = document.getElementById("glCanvas");
  if (!canvas) {
      alert("Error: Could not find glCanvas element!");
      return;
  }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl = canvas.getContext("webgl");
  if (!gl) {
    alert("WebGL not supported. Please use a modern browser like Chrome or Firefox.");
    return;
  }
  console.log("WebGL Vendor:", gl.getParameter(gl.VENDOR));
  console.log("WebGL Renderer:", gl.getParameter(gl.RENDERER));
  console.log("WebGL Version:", gl.getParameter(gl.VERSION));
  console.log("GLSL Version:", gl.getParameter(gl.SHADING_LANGUAGE_VERSION));


  shaderProgram = initShaderProgram(gl, vsSource, fsSource);
   if (!shaderProgram) {
      console.error("Failed to initialize shader program.");
      return;
  }
  attribLocations = {
    aPosition: gl.getAttribLocation(shaderProgram, "aPosition"),
    aTexCoord: gl.getAttribLocation(shaderProgram, "aTexCoord")
  };
  uniformLocations = {
    uProjection: gl.getUniformLocation(shaderProgram, "uProjection"),
    uView: gl.getUniformLocation(shaderProgram, "uView"),
    uModel: gl.getUniformLocation(shaderProgram, "uModel"),
    uTexture: gl.getUniformLocation(shaderProgram, "uTexture")
  };

  if (attribLocations.aPosition < 0 || attribLocations.aTexCoord < 0 ||
      !uniformLocations.uProjection || !uniformLocations.uView ||
      !uniformLocations.uModel || !uniformLocations.uTexture) {
      console.error("Failed to get shader locations.");
      return;
  }

  textures.ground = loadTexture(gl, "ground.jpg");
  textures.roof   = loadTexture(gl, "roof.jpg");
  textures.brick  = loadTexture(gl, "brick.jpg");
  textures.exit   = loadTexture(gl, "exit.png");

  mazeData = createMap(mazeWidth, mazeHeight, maxRooms, roomMinSize, roomMaxSize, Date.now());

  if (mazeData.rooms && mazeData.rooms.length > 0) {
    let spawnRoom = mazeData.rooms[0];
    playerPos[0] = spawnRoom.center[0] + 0.5;
    playerPos[2] = spawnRoom.center[1] + 0.5;
  } else {
       console.warn("No rooms found for initial spawn, placing player at default [1.5, 0, 1.5]");
       playerPos = [1.5, 0.0, 1.5];
        let foundSpawn = false;
        for (let z = 1; z < mazeHeight - 1; z++) {
            for (let x = 1; x < mazeWidth - 1; x++) {
                if (mazeData.maze[z][x] === ' ') {
                    playerPos = [x + 0.5, 0.0, z + 0.5];
                    foundSpawn = true;
                    break;
                }
            }
            if(foundSpawn) break;
        }
         if (!foundSpawn) console.error("Could not find any valid spawn point in the initial maze!");
  }

  geometry = buildMazeGeometry(mazeData.maze);
  initBuffers();

  discovered = [];
  for (let i = 0; i < mazeData.maze.length; i++) {
    discovered[i] = [];
    for (let j = 0; j < mazeData.maze[i].length; j++) {
      discovered[i][j] = false;
    }
  }
   updateDiscovered();


  gl.clearColor(0.2, 0.2, 0.3, 1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);


  const overlay = document.getElementById("mazeCanvas");
  if (!overlay) {
      alert("Error: Could not find mazeCanvas element!");
      return;
  }
  overlay.addEventListener("mousedown", onMouseDown, false);
  overlay.addEventListener("mousemove", onMouseMove, false);
  overlay.addEventListener("mouseup", onMouseUp, false);
  overlay.addEventListener("mouseleave", onMouseUp, false);

  lastManualInputTime = performance.now();
  lastFrameTime = performance.now();
  autoStarted = false;

  requestAnimationFrame(render); // Start the main loop
}

function initBuffers() {
  if (buffers.floor) gl.deleteBuffer(buffers.floor.buffer);
  if (buffers.ceiling) gl.deleteBuffer(buffers.ceiling.buffer);
  if (buffers.wallBrick) gl.deleteBuffer(buffers.wallBrick.buffer);
  if (buffers.wallExit) gl.deleteBuffer(buffers.wallExit.buffer);

  buffers.floor = initBuffer(geometry.floor);
  buffers.ceiling = initBuffer(geometry.ceiling);
  buffers.wallBrick = initBuffer(geometry.wallBrick);
  buffers.wallExit = initBuffer(geometry.wallExit);
}

function initBuffer(dataArray) {
  if (!dataArray || dataArray.length === 0) {
       return { buffer: null, vertexCount: 0 };
  }
  const buffer = gl.createBuffer();
  if (!buffer) {
      console.error("Failed to create WebGL buffer.");
      return { buffer: null, vertexCount: 0 };
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, dataArray, gl.STATIC_DRAW);
  return {
    buffer: buffer,
    vertexCount: dataArray.length / 5 // 5 components per vertex (x,y,z, u,v)
  };
}

// ============================ Render Loop ============================
function render(now) {
  const deltaTime = (now - lastFrameTime) / 1000.0;
  lastFrameTime = now;

  // --- Update Animation States ---
  if (animatingTranslation) {
    let t = (performance.now() - translationStart) / translationDuration;
    t = Math.min(t, 1.0);
    let easedT = 1 - Math.pow(1 - t, 3);
    playerPos[0] = lerp(startPos[0], targetPos[0], easedT);
    playerPos[2] = lerp(startPos[2], targetPos[2], easedT);
    if (t >= 1.0) {
       animatingTranslation = false;
       playerPos = [...targetPos];
       updateDiscovered();
    }
  }
  if (animatingRotation) {
    let t = (performance.now() - rotationStart) / rotationDuration;
    t = Math.min(t, 1.0);
    let easedT = 1 - Math.pow(1 - t, 3);
    playerAngle = lerpAngle(startAngle, targetAngle, easedT);
    playerAngle = (playerAngle + 360) % 360;
    if (t >= 1.0) {
       animatingRotation = false;
       playerAngle = targetAngle;
       updateDiscovered();
    }
  }

  // -------- Handle Manual Player Movement -----------
  // MODIFIED: Logic now branches based on the new 'manualMoveStyle' variable
  if (!botMode) {
      // Free-roam style (hold to move)
      if (manualMoveStyle === 'free') {
          const manualMoveSpeed = 4.5;
          let moveX = 0;
          let moveZ = 0;

          const rad = toRadian(playerAngle);
          if (keysDown["w"] || keysDown["arrowup"]) {
              moveX += Math.sin(rad) * manualMoveSpeed * deltaTime;
              moveZ += Math.cos(rad) * manualMoveSpeed * deltaTime;
          }
          if (keysDown["s"] || keysDown["arrowdown"]) {
              moveX -= Math.sin(rad) * manualMoveSpeed * deltaTime;
              moveZ -= Math.cos(rad) * manualMoveSpeed * deltaTime;
          }

          if (moveX !== 0 || moveZ !== 0) {
              const targetX = playerPos[0] + moveX;
              const targetZ = playerPos[2] + moveZ;
              if (canMove(targetX, targetZ)) {
                  playerPos[0] = targetX;
                  playerPos[2] = targetZ;
                  updateDiscovered();
              }
          }
      }
      // Step-by-step style is handled entirely in onKeyDown.
      
      // Turning is handled for BOTH manual styles here.
      if (!animatingRotation) {
          if (keysDown["a"] || keysDown["arrowleft"]) {
              handleTurnLeft();
          } else if (keysDown["d"] || keysDown["arrowright"]) {
              handleTurnRight();
          }
      }
  }


  // -------- Bot mode automatic movement logic (MODIFIED)-----------
  if (botMode && !animatingTranslation && !animatingRotation) {
      if (botPath && botPath.length > 0 && botPathIndex < botPath.length) {
        let nextCell = botPath[botPathIndex];
        let targetX = nextCell.x + 0.5;
        let targetZ = nextCell.y + 0.5;
        let dx = targetX - playerPos[0];
        let dz = targetZ - playerPos[2];
        let distSq = dx*dx + dz*dz;

         if (distSq < 0.01) {
             botPathIndex++;
             if (botPathIndex >= botPath.length) {
                 console.log("Bot reached end of path.");
             } else {
                nextCell = botPath[botPathIndex];
                targetX = nextCell.x + 0.5;
                targetZ = nextCell.y + 0.5;
                dx = targetX - playerPos[0];
                dz = targetZ - playerPos[2];
             }
         }

        if (botPathIndex < botPath.length) {
            let desiredAngle = (Math.atan2(dx, dz) * (180 / Math.PI) + 360) % 360;
            let angleDiff = desiredAngle - playerAngle;
            if (angleDiff > 180) angleDiff -= 360;
            if (angleDiff <= -180) angleDiff += 360;

            if (Math.abs(angleDiff) > 1) {
                animatingRotation = true;
                rotationStart = performance.now();
                startAngle = playerAngle;
                targetAngle = desiredAngle;
            } else {
                if (canMove(targetX, targetZ)) {
                    // MODIFIED: Check bot's visual style to determine if it animates or teleports.
                    if (botMoveStyle === 'smooth') {
                        animatingTranslation = true;
                        translationStart = performance.now();
                        startPos = [...playerPos];
                        targetPos = [targetX, playerPos[1], targetZ];
                    } else { // 'block' style for bot is instant
                        playerPos = [targetX, playerPos[1], targetZ];
                        updateDiscovered();
                    }
                } else {
                    console.warn("Bot collision detected. Recomputing.");
                    computeBotPath();
                }
            }
        }
      } else if (botMode) {
        let playerCellX = Math.floor(playerPos[0]);
        let playerCellZ = Math.floor(playerPos[2]);
         if (playerCellZ < 0 || playerCellZ >= mazeHeight || playerCellX < 0 || playerCellX >= mazeWidth ||
             mazeData.maze[playerCellZ].charAt(playerCellX) !== 'E') {
             console.log("Bot has no path. Recomputing...");
             computeBotPath();
         }
      }
  }


  // --- WebGL Drawing ---
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.useProgram(shaderProgram);

  const fieldOfView = toRadian(75);
  const aspect = gl.canvas.width / gl.canvas.height;
  const zNear = 0.01;
  const zFar = 200.0;
  const projectionMatrix = glMatrix.mat4.create();
  glMatrix.mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);
  gl.uniformMatrix4fv(uniformLocations.uProjection, false, projectionMatrix);

  const viewMatrix = glMatrix.mat4.create();
  const eye = [playerPos[0], playerPos[1] + 0.5, playerPos[2]];
  const direction = [Math.sin(toRadian(playerAngle)), 0, Math.cos(toRadian(playerAngle))];
  const center = [eye[0] + direction[0], eye[1] + direction[1], eye[2] + direction[2]];
  const up = [0, 1, 0];
  glMatrix.mat4.lookAt(viewMatrix, eye, center, up);
  gl.uniformMatrix4fv(uniformLocations.uView, false, viewMatrix);

  const modelMatrix = glMatrix.mat4.create();
  drawObject(buffers.floor, textures.ground, modelMatrix);
  drawObject(buffers.ceiling, textures.roof, modelMatrix);
  drawObject(buffers.wallBrick, textures.brick, modelMatrix);
  drawObject(buffers.wallExit, textures.exit, modelMatrix);

  // --- Update 2D Overlay ---
  updateOverlay();

  // --- Check for Game Win Condition ---
  if (!animatingTranslation && !animatingRotation) {
    let currentCellX = Math.floor(playerPos[0]);
    let currentCellZ = Math.floor(playerPos[2]);
     if (currentCellZ >= 0 && currentCellZ < mazeHeight && currentCellX >= 0 && currentCellX < mazeWidth) {
         if (mazeData.maze[currentCellZ].charAt(currentCellX) === 'E') {
             restartGame();
         }
     }
  }

  requestAnimationFrame(render);
}

 function drawObject(bufferObj, texture, modelMatrix) {
  if (!gl || !bufferObj || !bufferObj.buffer || bufferObj.vertexCount === 0 || !texture) {
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, bufferObj.buffer);
  gl.vertexAttribPointer(attribLocations.aPosition, 3, gl.FLOAT, false, 5 * 4, 0);
  gl.enableVertexAttribArray(attribLocations.aPosition);
  gl.vertexAttribPointer(attribLocations.aTexCoord, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
  gl.enableVertexAttribArray(attribLocations.aTexCoord);
  gl.uniformMatrix4fv(uniformLocations.uModel, false, modelMatrix);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(uniformLocations.uTexture, 0);
  gl.drawArrays(gl.TRIANGLES, 0, bufferObj.vertexCount);
}

// ============================ 2D Overlay Functions ============================
function drawFullMap(ctx, maze, discovered, playerCoord, fullMapOffsetX, fullMapOffsetY, windowWidth, windowHeight) {
  const cellSize = 10;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, windowWidth, windowHeight);
  ctx.clip();
  for (let i = 0; i < maze.length; i++) {
    for (let j = 0; j < maze[0].length; j++) {
      let x = fullMapOffsetX + j * cellSize;
      let y = fullMapOffsetY + i * cellSize;
      if (x + cellSize < 0 || x > windowWidth || y + cellSize < 0 || y > windowHeight) continue;
      if (discovered && discovered[i] && discovered[i][j]) {
        const cell = maze[i].charAt(j);
        if (cell === "#") ctx.fillStyle = "rgb(80, 80, 80)";
        else if (cell === "E") ctx.fillStyle = "rgb(255, 60, 60)";
        else if (cell === "B") ctx.fillStyle = "rgb(40, 40, 40)";
        else ctx.fillStyle = "rgb(200, 200, 200)";
      } else {
        ctx.fillStyle = "rgb(20, 20, 20)";
      }
      ctx.fillRect(x, y, cellSize, cellSize);
    }
  }
  const playerMapX = fullMapOffsetX + playerPos[0] * cellSize;
  const playerMapY = fullMapOffsetY + playerPos[2] * cellSize;
  const playerSize = cellSize * 0.8;
  const angleRad = toRadian(playerAngle);
  ctx.save();
  ctx.translate(playerMapX, playerMapY);
  ctx.rotate(-angleRad);
  ctx.fillStyle = "lime";
  ctx.beginPath();
  ctx.moveTo(0, playerSize / 2);
  ctx.lineTo(-playerSize / 3, -playerSize / 3);
  ctx.lineTo(playerSize / 3, -playerSize / 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
   if (botMode && botPath && botPath.length > 0) {
       ctx.strokeStyle = "rgba(0, 255, 255, 0.7)";
       ctx.lineWidth = Math.max(1, cellSize / 4);
       ctx.beginPath();
       ctx.moveTo(playerMapX, playerMapY);
       for (let k = botPathIndex; k < botPath.length; k++) {
           let node = botPath[k];
           ctx.lineTo(fullMapOffsetX + (node.x + 0.5) * cellSize, fullMapOffsetY + (node.y + 0.5) * cellSize);
       }
       ctx.stroke();
   }
  ctx.restore();
}

function drawMinimap(ctx, maze, discovered, playerCoord, windowWidth, windowHeight) {
  const regionSize = 15;
  const cellSize = 6;
  const margin = 15;
  const mapWidthPixels = regionSize * cellSize;
  const mapHeightPixels = regionSize * cellSize;
  const startX = windowWidth - mapWidthPixels - margin;
  const startY = margin;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(startX - 3, startY - 3, mapWidthPixels + 6, mapHeightPixels + 6);
  ctx.strokeStyle = "rgba(150, 150, 150, 0.8)";
  ctx.lineWidth = 1;
  ctx.strokeRect(startX - 3, startY - 3, mapWidthPixels + 6, mapHeightPixels + 6);
  const playerCellX = Math.floor(playerPos[0]);
  const playerCellY = Math.floor(playerPos[2]);
  const startCellX = playerCellX - Math.floor(regionSize / 2);
  const startCellY = playerCellY - Math.floor(regionSize / 2);
  for (let i = 0; i < regionSize; i++) {
    for (let j = 0; j < regionSize; j++) {
      const mazeY = startCellY + i;
      const mazeX = startCellX + j;
      const drawX = startX + j * cellSize;
      const drawY = startY + i * cellSize;
      if (mazeY >= 0 && mazeY < maze.length && mazeX >= 0 && mazeX < maze[0].length) {
          if (discovered && discovered[mazeY] && discovered[mazeY][mazeX]) {
              const cell = maze[mazeY].charAt(mazeX);
              if (cell === "#") ctx.fillStyle = "rgb(80, 80, 80)";
              else if (cell === "E") ctx.fillStyle = "rgb(255, 60, 60)";
              else if (cell === "B") ctx.fillStyle = "rgb(40, 40, 40)";
              else ctx.fillStyle = "rgb(200, 200, 200)";
          } else {
              ctx.fillStyle = "rgb(20, 20, 20)";
          }
      } else {
          ctx.fillStyle = "rgba(0, 0, 0, 0)";
      }
      ctx.fillRect(drawX, drawY, cellSize, cellSize);
    }
  }
   const playerMiniMapX = startX + (playerPos[0] - startCellX) * cellSize;
   const playerMiniMapY = startY + (playerPos[2] - startCellY) * cellSize;
   const playerSize = cellSize * 1.2;
   const angleRad = toRadian(playerAngle);
   ctx.save();
   ctx.translate(playerMiniMapX, playerMiniMapY);
   ctx.rotate(-angleRad);
   ctx.fillStyle = "lime";
   ctx.beginPath();
   ctx.moveTo(0, playerSize * 0.6);
   ctx.lineTo(-playerSize * 0.4, -playerSize * 0.4);
   ctx.lineTo(playerSize * 0.4, -playerSize * 0.4);
   ctx.closePath();
   ctx.fill();
   ctx.restore();
}

function updateOverlay() {
  const overlay = document.getElementById("mazeCanvas");
   if (!overlay) return;
   const ctx = overlay.getContext("2d");
   if (!ctx) return;

   if (overlay.width !== window.innerWidth || overlay.height !== window.innerHeight) {
        overlay.width = window.innerWidth;
        overlay.height = window.innerHeight;
   }

  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (botMode && autoMapState !== 'IDLE') {
      const now = performance.now();
      const elapsed = now - autoMapTimer;
      switch (autoMapState) {
          case 'INITIAL_WAIT': if (elapsed >= autoMapInitialWait) { fullMapVisible = true; autoMapState = 'MAP_OPEN'; autoMapTimer = now; } break;
          case 'MAP_OPEN': if (elapsed >= autoMapOpenDuration) { fullMapVisible = false; autoMapState = 'MAP_CLOSED_WAIT'; autoMapTimer = now; } break;
          case 'MAP_CLOSED_WAIT': if (elapsed >= autoMapClosedWaitDuration) { fullMapVisible = true; autoMapState = 'MAP_OPEN'; autoMapTimer = now; } break;
      }
  }

  if (!mazeData || !mazeData.maze || !discovered) return;

  const playerCoord = { x: playerPos[0], y: playerPos[2] };
  if (fullMapVisible) {
    const mapCellSize = 10;
    let viewCenterX = overlay.width / 2;
    let viewCenterY = overlay.height / 2;
    let playerScreenX = playerCoord.x * mapCellSize;
    let playerScreenY = playerCoord.y * mapCellSize;
    let initialOffsetX = viewCenterX - playerScreenX;
    let initialOffsetY = viewCenterY - playerScreenY;
    drawFullMap(ctx, mazeData.maze, discovered, playerCoord, initialOffsetX + dragOffsetX, initialOffsetY + dragOffsetY, overlay.width, overlay.height);
  } else {
    drawMinimap(ctx, mazeData.maze, discovered, playerCoord, overlay.width, overlay.height);
  }

  // MODIFIED: Draw the help menu with separated controls
  if (helpVisible) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    const boxWidth = 400;
    const boxHeight = 420;
    const boxX = 20;
    const boxY = 20;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    
    ctx.fillStyle = "white";
    ctx.font = "15px monospace";
    ctx.textAlign = "left";
    const lineHeight = 20;
    let textX = boxX + 15;
    let textY = boxY + 35;
    
    // Capitalize first letter for display
    const manualStyleStr = manualMoveStyle.charAt(0).toUpperCase() + manualMoveStyle.slice(1);
    const botStyleStr = botMoveStyle.charAt(0).toUpperCase() + botMoveStyle.slice(1);

    const instructions = [
      "========== MAZE EXPLORER ==========",
      "PLAYER CONTROLS:",
      " W/Up Arrow   : Move Forward",
      " S/Down Arrow : Move Backward",
      " A/Left Arrow : Turn Left",
      " D/Right Arrow: Turn Right",
      " V            : Toggle Player Move Style",
      `   (Current: ${manualStyleStr})`,
      "",
      "BOT CONTROLS:",
      " B : Toggle Bot On/Off",
      " 1 : Algorithm: BFS",
      " 2 : Algorithm: DFS",
      " 3 : Algorithm: A*",
      " 4 : Algorithm: Explore",
      " N : Toggle Bot Visual Style",
      `   (Current: ${botStyleStr})`,
      "",
      "GENERAL:",
      " M : Toggle Full Map (Drag to Pan)",
      " H : Toggle Help (This Menu)",
      "",
      "GOAL: Find the Red Exit!",
    ];

    for (let i = 0; i < instructions.length; i++) {
      if (instructions[i].trim().startsWith("(")) {
        ctx.fillText(instructions[i], textX + 15, textY + i * lineHeight);
      } else {
        ctx.fillText(instructions[i], textX, textY + i * lineHeight);
      }
    }

  } else {
     if(!isDragging) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.font = "16px monospace";
        ctx.textAlign = "left";
        ctx.fillText("H for Help", 20, overlay.height - 20);
     }
  }

  // --- Draw Auto-Bot/Bot Status Text ---
  const now = performance.now();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  const centerX = overlay.width / 2;
  const centerY = overlay.height - 40;

  if (!botMode && !autoStarted) {
      const elapsed = now - lastManualInputTime;
      if (elapsed < countdownDuration) {
          const secs = Math.ceil((countdownDuration - elapsed) / 1000);
          ctx.fillText(`Auto-Bot Starting in: ${secs}s`, centerX, centerY);
      } else {
          console.log("Auto-starting bot in Explore mode.");
          autoStarted = true;
          botMode = true;
          selectedAlgorithm = "explore";
          computeBotPath();
          autoMapState = 'INITIAL_WAIT';
          autoMapTimer = performance.now();
      }
  }

   if (botMode) {
       let statusText = `Bot Active (${selectedAlgorithm.toUpperCase()}). Press B to toggle.`;
       ctx.fillText(statusText, centerX, centerY);
   }
   ctx.textAlign = "left";
}

// ============================ Window Load & Resize ============================
window.onload = init;

 window.onresize = () => {
     if (!gl) return;
     const canvas = document.getElementById("glCanvas");
     const overlay = document.getElementById("mazeCanvas");
     if (!canvas || !overlay) return;
     canvas.width = window.innerWidth;
     canvas.height = window.innerHeight;
     overlay.width = window.innerWidth;
     overlay.height = window.innerHeight;
     gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
     if (mazeData && discovered) {
        updateOverlay();
     }
 };
