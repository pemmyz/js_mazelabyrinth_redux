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
let helpVisible = false; // Start with help hidden

// Animation variables for smooth movement.
let animatingTranslation = false;
let translationStart = 0;
const translationDuration = 50; // milliseconds for movement step
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

// ----------- Continuous Movement State (NEW) -----------
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
  //mazeData.maze.forEach(row => console.log(row)); // Log the new maze layout

  // Reset discovered map (make all undiscovered initially)
  discovered = [];
  for (let i = 0; i < mazeData.maze.length; i++) {
    discovered[i] = [];
    for (let j = 0; j < mazeData.maze[i].length; j++) {
      // Start with only the starting cell discovered, or maybe none?
      // Let's make all undiscovered for a fresh start.
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
      // Fallback if no rooms generated (shouldn't happen with good generation)
      console.warn("No rooms found for spawn, placing player at default [1.5, 0, 1.5]");
      playerPos = [1.5, 0.0, 1.5]; // A default valid starting spot
      // Try to find *any* open space if default fails
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
            // Handle this critical error? Maybe alert user or stop game?
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

  // NEW: Reset the auto-map state
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
     // Dragging is a manual action, reset auto-start timer
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

// ============================ Movement Helper Functions (NEW) ============================
const moveSpeed = 0.15; // Adjust step distance if needed
const turnSpeed = 90;   // Degrees per turn key press

function handleMoveForward() {
    let rad = toRadian(playerAngle);
    let forward = [Math.sin(rad) * moveSpeed, 0, Math.cos(rad) * moveSpeed];
    let currentX = playerPos[0];
    let currentZ = playerPos[2];
    let targetX = currentX + forward[0];
    let targetZ = currentZ + forward[2];
    if (canMove(targetX, targetZ)) {
        animatingTranslation=true;
        translationStart=performance.now();
        startPos=[...playerPos];
        targetPos=[targetX, playerPos[1], targetZ];
        // Timer reset is handled in onKeyDown
    }
}

function handleMoveBackward() {
    let rad = toRadian(playerAngle);
    let forward = [Math.sin(rad) * moveSpeed, 0, Math.cos(rad) * moveSpeed];
    let currentX = playerPos[0];
    let currentZ = playerPos[2];
    let targetX = currentX - forward[0];
    let targetZ = currentZ - forward[2];
    if (canMove(targetX, targetZ)) {
        animatingTranslation=true;
        translationStart=performance.now();
        startPos=[...playerPos];
        targetPos=[targetX, playerPos[1], targetZ];
        // Timer reset is handled in onKeyDown
    }
}

function handleTurnLeft() {
    animatingRotation=true;
    rotationStart=performance.now();
    startAngle=playerAngle;
    // Ensure target angle wraps correctly (e.g., 0 + 90 = 90, 270 + 90 = 0)
    targetAngle = (playerAngle + turnSpeed + 360) % 360;
    // Timer reset is handled in onKeyDown
}

function handleTurnRight() {
    animatingRotation=true;
    rotationStart=performance.now();
    startAngle=playerAngle;
    // Ensure target angle wraps correctly (e.g., 0 - 90 = 270)
    targetAngle = (playerAngle - turnSpeed + 360) % 360;
    // Timer reset is handled in onKeyDown
}


// ============================ Keyboard Controls (MODIFIED) ============================
function onKeyDown(e) {
  // This function now primarily handles toggles, algorithm selection,
  // and resetting the auto-start timer on *any* relevant key press.
  // Movement initiation is moved to the render loop based on keysDown state.

  let isManualAction = false; // Flag to check if countdown should reset
  let key = e.key.toLowerCase();

  // 1) Always handle toggles & bot/algorithm keys:
  switch (key) {
      case "b":
          botMode = !botMode;
          console.log("Bot mode " + (botMode ? "enabled" : "disabled"));
          if (botMode) {
              computeBotPath(); // Compute path if enabling
              // NEW: Start the auto-map cycle
              autoMapState = 'INITIAL_WAIT';
              autoMapTimer = performance.now();
          } else {
              // NEW: Stop the auto-map cycle and close the map
              autoMapState = 'IDLE';
              fullMapVisible = false;
          }
          // Toggling bot mode IS a manual action
          isManualAction = true;
          break;
      case "1": case "2": case "3": case "4":
          const algMap = { "1":"bfs","2":"dfs","3":"astar","4":"explore" };
          selectedAlgorithm = algMap[key];
          console.log("Algorithm selected:", selectedAlgorithm.toUpperCase());
          if (botMode) {
              computeBotPath(); // Recompute path if bot is already running
          }
          // Selecting algorithm is a manual action ONLY if bot is currently OFF
          if (!botMode) {
              isManualAction = true;
          }
          break;
      case "m":
          fullMapVisible = !fullMapVisible;

          // NEW: If user manually toggles map, disable the auto-toggling feature for this session
          if (botMode) {
              console.log("Manual map override: Disabling auto-map.");
              autoMapState = 'IDLE';
          }

          // Reset drag offset when toggling map, keep center focused on player
          if (fullMapVisible) {
              dragOffsetX = 0;
              dragOffsetY = 0;
          }
          // Toggling map doesn't reset the auto-start timer
          return; // Return here
      case "h":
          helpVisible = !helpVisible;
          // Toggling help doesn't reset the auto-start timer
          return; // Return here
  }

  // 2) Check if the pressed key is a movement key to reset the timer
  //    (even if movement is blocked by bot/animation, pressing the key counts as manual input)
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
       isManualAction = true;
  }

  // 3) Reset auto-start timer if any manual action occurred
  if (isManualAction) {
       lastManualInputTime = performance.now();
       autoStarted = false; // Reset auto-start state
  }

  // Prevent default browser behavior for arrow keys, etc. if needed
  // if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
  //    e.preventDefault();
  // }
}
// Add event listeners for keydown/keyup inside the script
// (These were defined globally earlier near keysDown definition)


// ============================ Update Discovered Cells ============================
function updateDiscovered() {
  const px = Math.floor(playerPos[0]);
  const pz = Math.floor(playerPos[2]);
  const viewDistance = 5; // How many cells ahead/sides to reveal

  // Simple rectangular visibility cone for now
  const angleRad = toRadian(playerAngle);
  const dx = Math.sin(angleRad);
  const dz = Math.cos(angleRad);

  for (let i = -viewDistance; i <= viewDistance; i++) {
    for (let j = -viewDistance; j <= viewDistance; j++) {
      // Check if cell is within a forward-facing cone/rectangle area
      // This is a very rough approximation - could be improved
      let checkX = px + j;
      let checkZ = pz + i;

      // Basic distance check
      if (Math.sqrt(i*i + j*j) > viewDistance + 1) continue;

      // Reveal cells within bounds
      if (checkZ >= 0 && checkZ < mazeHeight && checkX >= 0 && checkX < mazeWidth) {
          // Basic line of sight check (very simple, doesn't handle corners well)
          // Only reveal if there isn't a wall directly between player and cell
          let wallInWay = false;
          // Simple check: if target is further than 1 cell, check intermediate cells
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
   // Always ensure the player's current cell is discovered
   if (pz >= 0 && pz < mazeHeight && px >= 0 && px < mazeWidth) {
       discovered[pz][px] = true;
   }
}


// ============================ Initialization ============================
function init() {
  const canvas = document.getElementById("glCanvas");
  // Check if canvas exists before trying to set width/height
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
  // Log GL capabilities
  console.log("WebGL Vendor:", gl.getParameter(gl.VENDOR));
  console.log("WebGL Renderer:", gl.getParameter(gl.RENDERER));
  console.log("WebGL Version:", gl.getParameter(gl.VERSION));
  console.log("GLSL Version:", gl.getParameter(gl.SHADING_LANGUAGE_VERSION));


  shaderProgram = initShaderProgram(gl, vsSource, fsSource);
   if (!shaderProgram) {
      console.error("Failed to initialize shader program.");
      return; // Stop initialization if shaders fail
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

  // Check if attributes/uniforms were found
  if (attribLocations.aPosition < 0 || attribLocations.aTexCoord < 0 ||
      !uniformLocations.uProjection || !uniformLocations.uView ||
      !uniformLocations.uModel || !uniformLocations.uTexture) {
      console.error("Failed to get shader locations.");
      // Optionally provide more specific error messages
      if(attribLocations.aPosition < 0) console.error("aPosition location not found");
      // ... etc
      return; // Stop if locations are missing
  }


  // Load textures (provide placeholder paths or actual image URLs)
  // ** IMPORTANT: Make sure these image files exist in the same directory **
  textures.ground = loadTexture(gl, "ground.jpg"); // Replace/provide this texture
  textures.roof   = loadTexture(gl, "roof.jpg");   // Replace/provide this texture
  textures.brick  = loadTexture(gl, "brick.jpg");  // Replace/provide this texture
  textures.exit   = loadTexture(gl, "exit.png");   // Replace/provide this texture

  // Initial maze generation
  mazeData = createMap(mazeWidth, mazeHeight, maxRooms, roomMinSize, roomMaxSize, Date.now()); // Use current time as seed
  //mazeData.maze.forEach(row => console.log(row)); // Log initial maze

  // Place player in the first room
  if (mazeData.rooms && mazeData.rooms.length > 0) {
    let spawnRoom = mazeData.rooms[0];
    playerPos[0] = spawnRoom.center[0] + 0.5;
    playerPos[2] = spawnRoom.center[1] + 0.5;
  } else {
      // Fallback spawn logic (as in restartGame)
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

  // Initialize discovered array based on maze size
  discovered = [];
  for (let i = 0; i < mazeData.maze.length; i++) {
    discovered[i] = [];
    for (let j = 0; j < mazeData.maze[i].length; j++) {
      discovered[i][j] = false; // Start all undiscovered
    }
  }
   updateDiscovered(); // Discover initial area around the player


  gl.clearColor(0.2, 0.2, 0.3, 1.0); // Dark blue-grey background
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL); // Standard depth testing
  //gl.enable(gl.CULL_FACE); // Cull back faces for potential performance gain
  //gl.cullFace(gl.BACK);


  const overlay = document.getElementById("mazeCanvas");
  // Check if overlay canvas exists before adding listeners
  if (!overlay) {
      alert("Error: Could not find mazeCanvas element!");
      return;
  }
  overlay.addEventListener("mousedown", onMouseDown, false);
  overlay.addEventListener("mousemove", onMouseMove, false);
  overlay.addEventListener("mouseup", onMouseUp, false);
  overlay.addEventListener("mouseleave", onMouseUp, false); // Stop dragging if mouse leaves canvas

  // === Auto-Start Initialization ===
  lastManualInputTime = performance.now(); // Initialize countdown timer start
  autoStarted = false;                   // Bot hasn't auto-started yet

  requestAnimationFrame(render); // Start the main loop
}

function initBuffers() {
  // Clean up old buffers if they exist (important for restart)
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
       // Return a dummy object if there's no data (e.g., no exit walls)
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

// ============================ Render Loop (MODIFIED) ============================
function render(now) { // 'now' is provided by requestAnimationFrame
  let currentTime = performance.now(); // Use performance.now() for interval calculations

  // --- Update Player Position/Angle based on Animation ---
  if (animatingTranslation) {
    let t = (currentTime - translationStart) / translationDuration;
    t = Math.min(t, 1.0); // Clamp t to 1
    // Use smoother easing function (e.g., ease-out cubic)
    let easedT = 1 - Math.pow(1 - t, 3);
    playerPos[0] = lerp(startPos[0], targetPos[0], easedT);
    // playerPos[1] = lerp(startPos[1], targetPos[1], easedT); // Y position doesn't change
    playerPos[2] = lerp(startPos[2], targetPos[2], easedT);
    if (t >= 1.0) {
       animatingTranslation = false;
       playerPos = [...targetPos]; // Ensure exact final position
       updateDiscovered(); // Update visibility after movement stops
    }
  }
  if (animatingRotation) {
    let t = (currentTime - rotationStart) / rotationDuration;
    t = Math.min(t, 1.0);
    let easedT = 1 - Math.pow(1 - t, 3);
    playerAngle = lerpAngle(startAngle, targetAngle, easedT);
    playerAngle = (playerAngle + 360) % 360; // Keep angle in [0, 360)
    if (t >= 1.0) {
       animatingRotation = false;
       playerAngle = targetAngle; // Ensure exact final angle
       updateDiscovered(); // Update visibility after turning stops
    }
  }

  // -------- Handle Continuous Manual Movement (NEW) -----------
  if (!botMode && !animatingTranslation && !animatingRotation) {
      // Check keysDown state *every frame* to initiate movement if needed
      if (keysDown["w"] || keysDown["arrowup"])    handleMoveForward();
      else if (keysDown["s"] || keysDown["arrowdown"])  handleMoveBackward(); // Use else if to prevent moving fwd/back simultaneously

      // Turning can happen independently of forward/back movement (or simultaneously if desired)
      if (keysDown["a"] || keysDown["arrowleft"])  handleTurnLeft();
      else if (keysDown["d"] || keysDown["arrowright"]) handleTurnRight(); // Use else if to prevent spinning wildly
  }


  // -------- Bot mode automatic movement logic -----------
  if (botMode && !animatingTranslation && !animatingRotation) {
      // --- Bot logic remains the same ---
      if (botPath && botPath.length > 0 && botPathIndex < botPath.length) {
        let currentCell = { x: Math.floor(playerPos[0]), y: Math.floor(playerPos[2]) };
        let nextCell = botPath[botPathIndex];

        // Target the center of the next cell
        let targetX = nextCell.x + 0.5;
        let targetZ = nextCell.y + 0.5;

        let dx = targetX - playerPos[0];
        let dz = targetZ - playerPos[2];
        let distSq = dx*dx + dz*dz;

         // If very close to the target cell center, advance to the next path node
         if (distSq < 0.01) { // Threshold for reaching the cell center
             botPathIndex++;
             if (botPathIndex >= botPath.length) {
                 console.log("Bot reached end of path.");
                 // Reached end, path logic handled below (checking exit)
             } else {
                // Continue to the next cell in the path
                nextCell = botPath[botPathIndex];
                targetX = nextCell.x + 0.5;
                targetZ = nextCell.y + 0.5;
                dx = targetX - playerPos[0];
                dz = targetZ - playerPos[2];
             }
         }


        // Only proceed if there's a valid next cell
        if (botPathIndex < botPath.length) {
            // --- Bot Rotation ---
            let desiredAngle = Math.atan2(dx, dz) * (180 / Math.PI); // Angle towards target
            desiredAngle = (desiredAngle + 360) % 360;

            // Calculate the difference, handling wrap-around
            let angleDiff = desiredAngle - playerAngle;
            if (angleDiff > 180) angleDiff -= 360;
            if (angleDiff <= -180) angleDiff += 360;

            // If significant rotation is needed, rotate first
            if (Math.abs(angleDiff) > 1) { // Tolerance for angle alignment
                animatingRotation = true;
                rotationStart = performance.now();
                startAngle = playerAngle;
                // Snap to the closest cardinal direction if desired, or use exact angle
                // Snapping:
                // targetAngle = Math.round(desiredAngle / 90) * 90 % 360;
                // Exact:
                targetAngle = desiredAngle;
            }
            // --- Bot Translation ---
            else { // If facing roughly the right way, move forward
                // Calculate intended next position based on target cell center
                // We want to move directly towards the target cell center now
                let moveRad = toRadian(desiredAngle); // Angle towards target
                let botMoveSpeed = 0.1; // Can adjust bot speed
                let moveStepX = Math.sin(moveRad) * botMoveSpeed;
                let moveStepZ = Math.cos(moveRad) * botMoveSpeed;
                let nextPosX = playerPos[0] + moveStepX;
                let nextPosZ = playerPos[2] + moveStepZ;

                // Check if the *intended* next grid cell is walkable before starting animation
                let checkX = Math.floor(targetX);
                let checkZ = Math.floor(targetZ);
                if (checkZ >= 0 && checkZ < mazeHeight && checkX >= 0 && checkX < mazeWidth &&
                   (mazeData.maze[checkZ][checkX] === ' ' || mazeData.maze[checkZ][checkX] === 'E'))
                {
                     // Use the calculated target cell center, not just one step
                     // Final collision check with buffer using target cell center
                     if (canMove(targetX, targetZ)) {
                        animatingTranslation = true;
                        translationStart = performance.now();
                        startPos = [...playerPos];
                        // Animate towards the center of the target cell
                        targetPos = [targetX, playerPos[1], targetZ];
                     } else {
                          console.warn("Bot collision detected despite path (target center). Recomputing.");
                          computeBotPath(); // Path is likely blocked, recompute
                     }
                } else {
                    console.warn("Bot target cell is invalid. Recomputing path.");
                    computeBotPath(); // Target cell is bad, recompute
                }
            }
        }
      } else if (botMode) { // Bot is on, but path is empty or finished
        // Check if we are on the exit cell first
        let playerCellX = Math.floor(playerPos[0]);
        let playerCellZ = Math.floor(playerPos[2]);
         if (playerCellZ >= 0 && playerCellZ < mazeHeight && playerCellX >= 0 && playerCellX < mazeWidth &&
             mazeData.maze[playerCellZ].charAt(playerCellX) === 'E') {
             // Bot has reached the exit, let the exit logic handle restart
         } else {
             // If bot is on but has no path (e.g., failed computation), try recomputing
             console.log("Bot has no path or finished prematurely. Recomputing...");
             computeBotPath();
         }
      }
  }


  // --- WebGL Drawing ---
  // Ensure gl context is available before proceeding
  if (!gl) {
      console.error("Render loop: WebGL context lost or not initialized.");
      return;
  }
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Check if shader program is valid before using
  if (!shaderProgram) {
      console.error("Render loop: Shader program not available.");
      return; // Skip rendering if shaders failed
  }
  gl.useProgram(shaderProgram);

  // Projection Matrix (FOV, Aspect Ratio, Near/Far Clipping)
  const fieldOfView = toRadian(75); // Adjusted FOV
  const aspect = gl.canvas.width / gl.canvas.height;
  const zNear = 0.01; // Closer near plane
  const zFar = 200.0; // Further far plane
  const projectionMatrix = glMatrix.mat4.create();
  glMatrix.mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);
  gl.uniformMatrix4fv(uniformLocations.uProjection, false, projectionMatrix);

  // View Matrix (Camera Position and Orientation)
  const viewMatrix = glMatrix.mat4.create();
  const eye = [playerPos[0], playerPos[1] + 0.5, playerPos[2]]; // Camera height at 0.5 units
  const direction = [
    Math.sin(toRadian(playerAngle)),
    0, // Look straight ahead horizontally
    Math.cos(toRadian(playerAngle))
  ];
  const center = [eye[0] + direction[0], eye[1] + direction[1], eye[2] + direction[2]];
  const up = [0, 1, 0]; // Y is up
  glMatrix.mat4.lookAt(viewMatrix, eye, center, up);
  gl.uniformMatrix4fv(uniformLocations.uView, false, viewMatrix);

  // Draw Maze Components (Model Matrix is identity for static world geometry)
  const modelMatrix = glMatrix.mat4.create(); // Identity matrix
  drawObject(buffers.floor, textures.ground, modelMatrix);
  drawObject(buffers.ceiling, textures.roof, modelMatrix);
  drawObject(buffers.wallBrick, textures.brick, modelMatrix);
  drawObject(buffers.wallExit, textures.exit, modelMatrix);

  // --- Update 2D Overlay ---
  updateOverlay(); // Includes map, help, and auto-start messages

  // --- Check for Game Win Condition ---
  // If player is physically on an exit cell and not currently moving/turning
  if (!animatingTranslation && !animatingRotation) {
    let currentCellX = Math.floor(playerPos[0]);
    let currentCellZ = Math.floor(playerPos[2]);
     // Check bounds before accessing maze array
     if (currentCellZ >= 0 && currentCellZ < mazeHeight && currentCellX >= 0 && currentCellX < mazeWidth) {
         if (mazeData.maze[currentCellZ].charAt(currentCellX) === 'E') {
             restartGame(); // Found the exit!
         }
     }
  }

  // Request next frame
  requestAnimationFrame(render);
}

 function drawObject(bufferObj, texture, modelMatrix) {
  // Check if buffer and texture are valid before attempting to draw
  if (!gl || !bufferObj || !bufferObj.buffer || bufferObj.vertexCount === 0 || !texture) {
    //console.warn("Skipping drawObject: Invalid buffer or texture or GL context.");
    return;
  }
  // Check if shader locations are valid
  if (attribLocations.aPosition < 0 || attribLocations.aTexCoord < 0 || !uniformLocations.uModel || !uniformLocations.uTexture) {
      console.error("Skipping drawObject: Invalid shader locations.");
      return;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, bufferObj.buffer);

  // Set up vertex attributes (Position and Texture Coordinates)
  // Stride: 5 * 4 bytes (3 floats for pos, 2 floats for texcoord)
  // Position attribute (vec3): 3 components, FLOAT, stride 20 bytes, offset 0
  gl.vertexAttribPointer(attribLocations.aPosition, 3, gl.FLOAT, false, 5 * 4, 0);
  gl.enableVertexAttribArray(attribLocations.aPosition);

  // Texture coordinate attribute (vec2): 2 components, FLOAT, stride 20 bytes, offset 12 bytes (3 * 4)
  gl.vertexAttribPointer(attribLocations.aTexCoord, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
  gl.enableVertexAttribArray(attribLocations.aTexCoord);

  // Set model matrix uniform
  gl.uniformMatrix4fv(uniformLocations.uModel, false, modelMatrix);

  // Set texture uniform
  gl.activeTexture(gl.TEXTURE0); // Activate texture unit 0
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(uniformLocations.uTexture, 0); // Tell shader to use texture unit 0

  // Draw the triangles
  gl.drawArrays(gl.TRIANGLES, 0, bufferObj.vertexCount);

   // It's good practice to disable vertex attrib arrays after drawing, though not strictly necessary if next draw call sets them up again.
  // gl.disableVertexAttribArray(attribLocations.aPosition);
  // gl.disableVertexAttribArray(attribLocations.aTexCoord);
}

// ============================ 2D Overlay Functions ============================
    // Draw the full, draggable map
function drawFullMap(ctx, maze, discovered, playerCoord, fullMapOffsetX, fullMapOffsetY, windowWidth, windowHeight) {
  const cellSize = 10; // Smaller cells for full map
  const cols = maze[0].length;
  const rows = maze.length;
  const mapWidth = cols * cellSize;
  const mapHeight = rows * cellSize;

  // Clip drawing to the canvas bounds for efficiency (optional but good practice)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, windowWidth, windowHeight);
  ctx.clip();

  // Draw map background (optional, can make seeing boundaries easier)
  // ctx.fillStyle = "rgba(50, 50, 50, 0.8)";
  // ctx.fillRect(fullMapOffsetX - 5, fullMapOffsetY - 5, mapWidth + 10, mapHeight + 10);


  // Draw grid lines (optional)
  // ctx.strokeStyle = "rgba(100, 100, 100, 0.5)";
  // ctx.lineWidth = 0.5;
  // for (let i = 0; i <= rows; i++) {
  //     ctx.beginPath();
  //     ctx.moveTo(fullMapOffsetX, fullMapOffsetY + i * cellSize);
  //     ctx.lineTo(fullMapOffsetX + mapWidth, fullMapOffsetY + i * cellSize);
  //     ctx.stroke();
  // }
  // for (let j = 0; j <= cols; j++) {
  //      ctx.beginPath();
  //      ctx.moveTo(fullMapOffsetX + j * cellSize, fullMapOffsetY);
  //      ctx.lineTo(fullMapOffsetX + j * cellSize, fullMapOffsetY + mapHeight);
  //      ctx.stroke();
  // }


  // Draw maze cells
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      let x = fullMapOffsetX + j * cellSize;
      let y = fullMapOffsetY + i * cellSize;

      // Optimization: Only draw cells potentially visible on screen
      if (x + cellSize < 0 || x > windowWidth || y + cellSize < 0 || y > windowHeight) {
          continue;
      }
      // Check if discovered array is initialized and has this cell
      if (discovered && discovered[i] && discovered[i][j] !== undefined) {
            if (discovered[i][j]) {
                const cell = maze[i].charAt(j);
                if (cell === "#") ctx.fillStyle = "rgb(80, 80, 80)";       // Dark Grey Wall
                else if (cell === "E") ctx.fillStyle = "rgb(255, 60, 60)";  // Bright Red Exit
                else if (cell === "B") ctx.fillStyle = "rgb(40, 40, 40)";   // Very Dark Grey Bulk Wall
                else ctx.fillStyle = "rgb(200, 200, 200)"; // Light Grey Floor
            } else {
                ctx.fillStyle = "rgb(20, 20, 20)"; // Undiscovered area
            }
       } else {
            // Handle cases where discovered might not be fully initialized yet (should be rare)
            ctx.fillStyle = "rgb(10, 10, 10)"; // Very dark grey for potentially uninitialized areas
            // Log error if needed: console.warn(`Discovered cell [${i}][${j}] is undefined`);
       }
      ctx.fillRect(x, y, cellSize, cellSize); // Draw the cell
    }
  }

  // Draw Player Icon (Arrow indicating direction)
  const playerMapX = fullMapOffsetX + playerPos[0] * cellSize; // Use exact playerPos for smooth icon movement
  const playerMapY = fullMapOffsetY + playerPos[2] * cellSize;
  const playerSize = cellSize * 0.8;
  const angleRad = toRadian(playerAngle);

  ctx.save();
  ctx.translate(playerMapX, playerMapY);
  ctx.rotate(-angleRad); // Rotate the context for the arrow
  ctx.fillStyle = "lime";
  ctx.beginPath();
  ctx.moveTo(0, playerSize / 2); // Arrow tip (forward)
  ctx.lineTo(-playerSize / 3, -playerSize / 3); // Back left corner
  ctx.lineTo(playerSize / 3, -playerSize / 3); // Back right corner
  ctx.closePath();
  ctx.fill();
  ctx.restore(); // Restore context rotation/translation

  // Draw Bot Path (if active and path exists)
   if (botMode && botPath && botPath.length > 0) {
       ctx.strokeStyle = "rgba(0, 255, 255, 0.7)"; // Cyan path
       ctx.lineWidth = Math.max(1, cellSize / 4);
       ctx.beginPath();
       // Start path from current player position for smoothness
       ctx.moveTo(playerMapX, playerMapY);
       // Draw line segments for the rest of the path
       for (let k = botPathIndex; k < botPath.length; k++) {
           let node = botPath[k];
           ctx.lineTo(fullMapOffsetX + (node.x + 0.5) * cellSize, fullMapOffsetY + (node.y + 0.5) * cellSize);
       }
       ctx.stroke();
   }


  ctx.restore(); // Restore clipping
}

// Draw the corner minimap
function drawMinimap(ctx, maze, discovered, playerCoord, windowWidth, windowHeight) {
  const regionSize = 15; // How many cells across/down the minimap shows
  const cellSize = 6;   // Small cells for minimap
  const margin = 15;
  const mapWidthPixels = regionSize * cellSize;
  const mapHeightPixels = regionSize * cellSize;
  const startX = windowWidth - mapWidthPixels - margin;
  const startY = margin;

  // Background for minimap
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(startX - 3, startY - 3, mapWidthPixels + 6, mapHeightPixels + 6);
   ctx.strokeStyle = "rgba(150, 150, 150, 0.8)";
   ctx.lineWidth = 1;
   ctx.strokeRect(startX - 3, startY - 3, mapWidthPixels + 6, mapHeightPixels + 6);


  const playerCellX = Math.floor(playerPos[0]); // Use floor for grid alignment
  const playerCellY = Math.floor(playerPos[2]);

  // Calculate top-left cell index for the minimap view
  const startCellX = playerCellX - Math.floor(regionSize / 2);
  const startCellY = playerCellY - Math.floor(regionSize / 2);

  for (let i = 0; i < regionSize; i++) {
    for (let j = 0; j < regionSize; j++) {
      const mazeY = startCellY + i;
      const mazeX = startCellX + j;
      const drawX = startX + j * cellSize;
      const drawY = startY + i * cellSize;

      // Check if the cell is within maze bounds
      if (mazeY >= 0 && mazeY < maze.length && mazeX >= 0 && mazeX < maze[0].length) {
          // Check if discovered array is initialized and has this cell
          if (discovered && discovered[mazeY] && discovered[mazeY][mazeX] !== undefined) {
              if (discovered[mazeY][mazeX]) {
                  const cell = maze[mazeY].charAt(mazeX);
                  if (cell === "#") ctx.fillStyle = "rgb(80, 80, 80)";
                  else if (cell === "E") ctx.fillStyle = "rgb(255, 60, 60)";
                  else if (cell === "B") ctx.fillStyle = "rgb(40, 40, 40)";
                  else ctx.fillStyle = "rgb(200, 200, 200)";
              } else {
                  ctx.fillStyle = "rgb(20, 20, 20)"; // Undiscovered
              }
          } else {
              ctx.fillStyle = "rgb(10, 10, 10)"; // Very dark for uninitialized/out of bounds
          }
      } else {
          ctx.fillStyle = "rgba(0, 0, 0, 0)"; // Outside maze bounds (transparent)
      }
      ctx.fillRect(drawX, drawY, cellSize, cellSize);
    }
  }

   // Draw Player Icon on Minimap (Arrow indicating direction)
   // Position relative to the minimap's top-left corner
   const playerMiniMapX = startX + (playerPos[0] - startCellX) * cellSize;
   const playerMiniMapY = startY + (playerPos[2] - startCellY) * cellSize;
   const playerSize = cellSize * 1.2; // Slightly larger icon
   const angleRad = toRadian(playerAngle);

   ctx.save();
   ctx.translate(playerMiniMapX, playerMiniMapY);
   ctx.rotate(-angleRad);
   ctx.fillStyle = "lime";
   ctx.beginPath();
   ctx.moveTo(0, playerSize * 0.6); // Arrow tip
   ctx.lineTo(-playerSize * 0.4, -playerSize * 0.4);
   ctx.lineTo(playerSize * 0.4, -playerSize * 0.4);
   ctx.closePath();
   ctx.fill();
   ctx.restore();
}

// Main function to update the entire 2D overlay canvas
function updateOverlay() {
  const overlay = document.getElementById("mazeCanvas");
  // Ensure overlay and context are valid
   if (!overlay) return;
   const ctx = overlay.getContext("2d");
   if (!ctx) return;

   // Ensure overlay matches window size (handle resize)
   if (overlay.width !== window.innerWidth || overlay.height !== window.innerHeight) {
        overlay.width = window.innerWidth;
        overlay.height = window.innerHeight;
   }

  ctx.clearRect(0, 0, overlay.width, overlay.height); // Clear previous frame

  // ================== NEW: AUTO-MAP STATE MACHINE ==================
  if (botMode && autoMapState !== 'IDLE') {
      const now = performance.now();
      const elapsed = now - autoMapTimer;

      switch (autoMapState) {
          case 'INITIAL_WAIT':
              if (elapsed >= autoMapInitialWait) {
                  console.log("Auto-map: Opening map.");
                  fullMapVisible = true;
                  autoMapState = 'MAP_OPEN';
                  autoMapTimer = now; // Reset timer for the next state
              }
              break;

          case 'MAP_OPEN':
              if (elapsed >= autoMapOpenDuration) {
                  console.log("Auto-map: Closing map.");
                  fullMapVisible = false;
                  autoMapState = 'MAP_CLOSED_WAIT';
                  autoMapTimer = now; // Reset timer
              }
              break;

          case 'MAP_CLOSED_WAIT':
              if (elapsed >= autoMapClosedWaitDuration) {
                  console.log("Auto-map: Re-opening map.");
                  fullMapVisible = true;
                  autoMapState = 'MAP_OPEN'; // Go back to the open state to loop
                  autoMapTimer = now; // Reset timer
              }
              break;
      }
  }
  // =================================================================

  // Check if maze data is loaded before drawing maps
  if (!mazeData || !mazeData.maze || !discovered) {
      console.warn("Overlay update skipped: Maze data not ready.");
      return; // Don't draw if data isn't ready
  }


  // --- Draw Map Components ---
  const playerCoord = { x: playerPos[0], y: playerPos[2] }; // Pass precise coords

  if (fullMapVisible) {
    // Center the map view based on player position initially, adjusted by drag offset
    const mapCellSize = 10; // Cell size used in drawFullMap
    let viewCenterX = overlay.width / 2;
    let viewCenterY = overlay.height / 2;
    let playerScreenX = playerCoord.x * mapCellSize;
    let playerScreenY = playerCoord.y * mapCellSize;

    // Calculate the top-left corner offset needed to center the player, then apply drag
    let initialOffsetX = viewCenterX - playerScreenX;
    let initialOffsetY = viewCenterY - playerScreenY;

    drawFullMap(ctx, mazeData.maze, discovered, playerCoord, initialOffsetX + dragOffsetX, initialOffsetY + dragOffsetY, overlay.width, overlay.height);
  } else {
    // Draw only the minimap if full map is hidden
    drawMinimap(ctx, mazeData.maze, discovered, playerCoord, overlay.width, overlay.height);
  }


  // --- Draw Help Text ---
  if (helpVisible) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    const boxWidth = 320; // Wider box
    const boxHeight = 290; // Taller box for more info
    const boxX = 10;
    const boxY = 10;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = "white";
    ctx.font = "14px monospace"; // Slightly smaller font
    const lineHeight = 18;
    let textX = boxX + 15;
    let textY = boxY + 30;
    const instructions = [
      "=== MAZE EXPLORER ===",
      "Controls:",
      " W/Up   : Move forward",
      " S/Down : Move backward",
      " A/Left : Turn left",
      " D/Right: Turn right",
      "",
      " M : Toggle Full Map",
      "     (Drag to Pan Map)",
      " H : Toggle Help (This Box)",
      "",
      "Bot Mode:",
      " B : Toggle Bot On/Off",
      " 1 : Set Bot to BFS",
      " 2 : Set Bot to DFS",
      " 3 : Set Bot to A*",
      " 4 : Set Bot to Explore",
      "",
      "Bot auto-starts if idle.",
      "Find the Red Exit!"
    ];
    for (let i = 0; i < instructions.length; i++) {
      ctx.fillText(instructions[i], textX, textY + i * lineHeight);
    }
  } else {
     // Show hint only if help is off and full map isn't being dragged
     if(!isDragging) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.font = "16px monospace";
        ctx.textAlign = "left"; // Reset alignment
        ctx.fillText("H for Help", 10, overlay.height - 20);
     }
  }


  // --- Auto-Start Logic & Display ---
  const now = performance.now();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "bold 20px monospace";
  ctx.textAlign = "center";
  const centerX = overlay.width / 2;
  const centerY = overlay.height - 40; // Position near bottom center


  if (!botMode && !autoStarted) { // Only show countdown if bot is OFF and hasn't auto-started yet
      const elapsed = now - lastManualInputTime;
      if (elapsed < countdownDuration) {
          const secs = Math.ceil((countdownDuration - elapsed) / 1000);
          ctx.fillText(`Auto-Bot Starting in: ${secs}s`, centerX, centerY);
      } else {
          // Time's up! Auto-start the bot
          console.log("Auto-starting bot in Explore mode.");
          autoStarted = true; // Mark as auto-started
          botMode = true; // Enable bot mode
          selectedAlgorithm = "explore"; // Force explore mode on auto-start
          computeBotPath(); // Calculate the path

          // NEW: Start the auto-map cycle when the bot auto-starts
          autoMapState = 'INITIAL_WAIT';
          autoMapTimer = performance.now();
      }
  }

  // Display status message if bot is running (either manually or auto-started)
   if (botMode) {
       let statusText = `Bot Active (${selectedAlgorithm.toUpperCase()}). Press B to toggle.`;
       ctx.fillText(statusText, centerX, centerY);
   } else if (autoStarted) {
       // If bot was auto-started but then manually turned off (botMode is false),
       // maybe show nothing or a different message?
       // For now, if !botMode, the countdown logic above handles restarting the timer.
       // So, we don't need a specific message here unless we want one like "Auto-bot paused".
   }

   // Reset text alignment if other text uses it
   ctx.textAlign = "left";
}

// ============================ Window Load & Resize ============================
window.onload = init; // Call init when the window (and its resources) are loaded

 // Handle window resize
 window.onresize = () => {
     // Check if gl context exists before proceeding
     if (!gl) return;

     const canvas = document.getElementById("glCanvas");
     const overlay = document.getElementById("mazeCanvas");

     // Ensure canvases exist before resizing
     if (!canvas || !overlay) return;

     canvas.width = window.innerWidth;
     canvas.height = window.innerHeight;
     overlay.width = window.innerWidth;
     overlay.height = window.innerHeight;

     // Update WebGL viewport
     gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

     // Re-draw overlay immediately after resize for responsiveness
     // Need to ensure mazeData is loaded before calling updateOverlay here
     if (mazeData && discovered) {
        updateOverlay();
     }
 };
