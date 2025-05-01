const container = document.getElementById("object-container");

const colors = [
  'ff0000',
  '00ff00',
  '0000ff',
  '000000',
  'cccccc'
];

const sizes = [
  
];

/*
let objects = [{
  groupId: 1,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[0]
},{
  groupId: 1,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[1]
},{
  groupId: 1,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[2]
},{
  groupId: 1,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[3]
},{
  groupId: 1,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[4]
},{
  groupId: 2,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[1]
},{
  groupId: 2,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[2]
},{
  groupId: 2,
  image: "https://via.placeholder.com/100/0000FF",
  color: colors[3]
}];
*/

// console.log(window.innerWidth, window.innerHeight);

const groups = {};
groups[1] = {x: 100, y: 100};
groups[2] = {x: 300, y: 500};
groups[3] = {x: 900, y: 50};
groups[4] = {x: 800, y: 400};
groups[5] = {x: 500, y: 150};
groups[6] = {x: 1150, y: 600};
groups[7] = {x: 1300, y: 150};

// console.log(groups);

let objectTypes = ['image', 'text'];

let objects = [];

for(let i=0; i<200; i++) {

  let objectType = objectTypes[Math.floor(Math.random() * 2)];

  let randomObjectWidth = Math.floor(Math.random() * (110 - 60 + 1)) + 60;
  let randomObjectHeight = Math.floor(Math.random() * (150 - 60 + 1)) + 60;
  let randomGroupId = Math.floor(Math.random() * Object.keys(groups).length + 1);

  let angle = Math.random() * 2 * Math.PI;
  let distance = Math.random() * 100;

  let newObject = {};

  if(objectType == 'image') {

    newObject = {
      id: `object_${i+1}`,
      type: 'image',
      groupId: randomGroupId,
      grid_x: 0,
      grid_y: 0,
      group_initial_x: groups[randomGroupId].x + Math.cos(angle) * distance,
      group_initial_y: groups[randomGroupId].y + Math.sin(angle) * distance,
      group_x: groups[randomGroupId].x + Math.cos(angle) * distance,
      group_y: groups[randomGroupId].y + Math.sin(angle) * distance,
      width: randomObjectWidth,
      height: randomObjectHeight,
      image: `https://picsum.photos/${randomObjectWidth}/${randomObjectHeight}`,
      text: '',
    }

  } else if (objectType == 'text') {

    newObject = {
      id: `object_${i+1}`,
      type: 'text',
      groupId: randomGroupId,
      grid_x: 0,
      grid_y: 0,
      group_initial_x: groups[randomGroupId].x + Math.cos(angle) * distance,
      group_initial_y: groups[randomGroupId].y + Math.sin(angle) * distance,
      group_x: groups[randomGroupId].x + Math.cos(angle) * distance,
      group_y: groups[randomGroupId].y + Math.sin(angle) * distance,
      width: randomObjectWidth,
      height: randomObjectHeight,
      image: '',
      text: 'hello world! This is some text.',
    }
  }

  objects.push(newObject);
}


const grid = document.getElementById("grid");

// console.log(document.documentElement.clientWidth);
// console.log(document.documentElement.clientHeight);

let zoomOutFactor = 0.9;
let zoomInFactor = 1.1;

/*
let gridDimension = {
  width: 0,
  height: 0
}
*/

/*
let gridSectionDimension = {
  'width': 150,
  'height': 200,
  'marginX': 40,
  'marginY': 40,
  'offsetX': 100,
}
*/

let gridWidthCalculated = false;

// TODO: content type video
// TODO: integrate offsetX again
// TODO: dynamic random placement of groups within viewport
// TODO: fix problem with transition from ungrouped to group (viewport)
// TODO: reverse group ungroup logic
// TODO: add grid debug mode

// TODO: non repeating image placing (to be done)

// TODO: content type text (done)
// TODO: set boundaries for dragging (done)
// TODO: calculate amount of rows and cols without waste of space (done)
// TODO: dynamic random placement of group items (done)
// TODO: get back grid margins (done)
// TODO: canvas dragging (done)
// TODO: center grid view (done)
// TODO: animation from pile to unklinked, unlinked to pile (done)
// TODO: dynamic cell sizes (not for now)
// TODO: cell margins (done)
// TODO: add video, text, image (to be done)

class Grid {

  _grid = Array();
  gridDimension = {
    width: 0,
    height: 0
  }
  gridSectionDimension = {
    'width': 200,
    'height': 180,
    'marginX': 60,
    'marginY': 40,
    'offsetX': 40,
  }

  constructor(gridId='grid', objects) {
    this.gridId = gridId;
    this.htmlGridElement = document.getElementById(gridId);
    this.objects = objects;
    this.createGrid();
    this.addObjectsRandomly();
  }

  createGrid() {
    //console.log(this.objects.length);
    //console.log(Math.sqrt(this.objects.length));

    let gridSectionCountX = Math.ceil(Math.sqrt(this.objects.length));
    let gridSectionCountY = Math.ceil(this.objects.length / gridSectionCountX);

    this.gridDimension.width = gridSectionCountX * this.gridSectionDimension.width + (gridSectionCountX-1) * this.gridSectionDimension.marginX;
    this.gridDimension.height = gridSectionCountY * this.gridSectionDimension.height + (gridSectionCountY-1) * this.gridSectionDimension.marginY;

    let gridToViewportDiffX = this.gridDimension.width - parseInt(window.innerWidth);
    let gridToViewportDiffY = this.gridDimension.height - parseInt(window.innerHeight);

    // console.log(gridToViewportDiffX, gridToViewportDiffY);

    grid.style.left = `-${Math.floor(gridToViewportDiffX / 2)}px`;
    grid.style.top = `-${Math.floor(gridToViewportDiffY / 2)}px`;

    //console.log(gridSectionCount);

    for(let row = 0; row < gridSectionCountY; row++) {
      for(let column = 0; column < gridSectionCountX; column++) {
        this._grid.push({
          section_id: `section_${column}_${row}`,
          x: this.gridSectionDimension.width * column + this.gridSectionDimension.marginX * column,
          y: this.gridSectionDimension.height * row + this.gridSectionDimension.marginY * row,
          object_id: '',
        });
      }
    }

    //console.log(this._grid);
  }

  addObjectsRandomly() {
    for(const object of this.objects) {
      let onlyEmptyGridSections = this._grid.filter(gridSection => gridSection.object_id == '');
      let randomGridSection = Math.floor(Math.random() * (onlyEmptyGridSections.length - 1));
      
      onlyEmptyGridSections[randomGridSection].object_id = object.id;

      let diffWidthImageToGrid = this.gridSectionDimension.width - object.width;
      let diffHeightImageToGrid = this.gridSectionDimension.height - object.height;
  
      let randomImageLeft = Math.floor(Math.random() * diffWidthImageToGrid + 1);
      let randomImageTop = Math.floor(Math.random() * diffHeightImageToGrid + 1);

      object.grid_x = onlyEmptyGridSections[randomGridSection].x + randomImageLeft;
      object.grid_y = onlyEmptyGridSections[randomGridSection].y + randomImageTop;

      const objectDiv = document.createElement("div");
      objectDiv.id = object.id;
      objectDiv.classList.add("object");
      objectDiv.style.top = `${object.grid_y}px`;
      objectDiv.style.left = `${object.grid_x}px`;
      objectDiv.style.width = `${object.width}px`;
      objectDiv.style.height = `${object.height}px`;
      objectDiv.style.backgroundImage = `url(${object.image})`;
      objectDiv.innerHTML = object.text;

      grid.appendChild(objectDiv);
    }

    // console.log(this._grid);
    // console.log(this.objects);
  }

  groupObjects(event) {
    event.preventDefault();
    console.log('group objects');

    for(const object of this.objects) {

      const element = document.getElementById(object.id);
      element.style.transform = '';

      const elementTargetX = object.group_x - object.grid_x;
      const elementTargetY = object.group_y - object.grid_y;

      element.style.transform = `translate(${elementTargetX}px, ${elementTargetY}px)`;
    }
  }

  ungroupObjects(event) {
    event.preventDefault();
    console.log('ungroup objects');

    for(const object of this.objects) {

      const element = document.getElementById(object.id);
      element.style.transform = '';

      /*
      const elementTargetX = object.grid_x - object.group_x;
      const elementTargetY = object.grid_y - object.group_y;

      element.style.transform = `translate(${elementTargetX}px, ${elementTargetY}px)`;
      */
    }
    
  }

  resetGrid(event) {
    grid.style.top = "0px";
    grid.style.left = "0px";
  }

  addObjectToPosition(position) {

  }

  addObjectRandomly() {

  }

  shuffleObjects() {

  }
}

const gridObject = new Grid('grid', objects);

grid.style.width = `${gridObject.gridDimension.width}px`;
grid.style.height = `${gridObject.gridDimension.height}px`;

// console.log(grid.style.width, grid.style.height);

const linkGroup = document.getElementById('link-group');
const linkUngroup = document.getElementById('link-ungroup');
const resetGrid = document.getElementById('reset-grid');

linkGroup.onclick = gridObject.groupObjects.bind(gridObject);
linkUngroup.onclick = gridObject.ungroupObjects.bind(gridObject);
resetGrid.onclick = gridObject.resetGrid.bind(gridObject);


/*
for(let i=0; i<4; i++) {
  for(let j=0; j<10; j++) {
    const gridSection = document.createElement("div");
    gridSection.classList.add("grid-section");
    gridSection.style.top = gridSectionDimension.height * i + i*gridSectionDimension.marginY + "px";
    gridSection.style.left = gridSectionDimension.width * j + j*gridSectionDimension.marginX + i%2*gridSectionDimension.offsetX + "px";
    gridSection.style.width = `${gridSectionDimension.width}px`;
    gridSection.style.height = `${gridSectionDimension.height}px`;

    if(!gridWidthCalculated) {
      gridDimension.width = gridDimension.width + gridSectionDimension.width + gridSectionDimension.marginX;
    }

    let randomImageWidth = Math.floor(Math.random() * (80 - 50 + 1)) + 50;
    let randomImageHeight = Math.floor(Math.random() * (130 - 50 + 1)) + 50;

    let diffWidthImageToGrid = gridSectionDimension.width - randomImageWidth;
    let diffHeightImageToGrid = gridSectionDimension.height - randomImageHeight;

    let randomImageLeft = Math.floor(Math.random() * diffWidthImageToGrid + 1);
    let randomImageTop = Math.floor(Math.random() * diffHeightImageToGrid + 1);

    const image = document.createElement("div");
    image.classList.add("image");
    image.style.top = `${randomImageTop}px`;
    image.style.left = `${randomImageLeft}px`;
    image.style.width = `${randomImageWidth}px`;
    image.style.height = `${randomImageHeight}px`;
    image.style.backgroundImage = `url(https://picsum.photos/${randomImageWidth}/${randomImageHeight})`;  
    gridSection.appendChild(image);

    grid.appendChild(gridSection);
  }
  gridWidthCalculated = true;
  gridDimension.height = gridDimension.height + gridSectionDimension.height + gridSectionDimension.marginY;
}

grid.style.width = `${gridDimension.width}px`;
grid.style.height = `${gridDimension.height}px`;

const gridSections = grid.children;
*/

let mouseDown = false;
let mouseDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

grid.addEventListener("mousedown", (e) => {
  mouseDown = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
});

grid.addEventListener("mousemove", (e) => {
  if(mouseDown) {

    document.body.style.cursor = "grabbing";

    mouseDragging = true;
    mouseDeltaX = e.clientX - lastMouseX;
    mouseDeltaY = e.clientY - lastMouseY;

    //console.log(mouseDeltaX, mouseDeltaY);
    
    let newGridX = parseInt(grid.style.left) + mouseDeltaX;
    let newGridY = parseInt(grid.style.top) + mouseDeltaY;

    //console.log(groups);

    /*
    for(let group in groups) {
      groups[group].x = groups[group].x + mouseDeltaX;
      groups[group].y = groups[group].y + mouseDeltaY;
    }
    */

    objects.forEach((object, index) => {
      object.group_x = object.group_initial_x - parseInt(grid.style.left);
      object.group_y = object.group_initial_y - parseInt(grid.style.top);
    });

    // console.log(objects);

    // console.log(newGridX, newGridY);

    if(newGridY < 0 && newGridY > (parseInt(window.innerHeight) - parseInt(grid.style.height))) {
      grid.style.top = `${newGridY}px`;
    }

    if(newGridX < 0 && newGridX > (parseInt(window.innerWidth) - parseInt(grid.style.width))) {
      grid.style.left = `${newGridX}px`;
    }

    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
});

grid.addEventListener("mouseup", (e) => {
  mouseDown = false;
  mouseDragging = false;
  document.body.style.cursor = "default";
});

function zoomOut() {

  Array.from(gridSections).forEach((gridSection, index) => {

    gridSection.style.left = `${parseInt(gridSection.style.left) * zoomOutFactor}px`;
    gridSection.style.top = `${parseInt(gridSection.style.top) * zoomOutFactor}px`;
    gridSection.style.width = `${parseInt(gridSection.style.width) * zoomOutFactor}px`;
    gridSection.style.height = `${parseInt(gridSection.style.height) * zoomOutFactor}px`;

    image = gridSection.getElementsByClassName("image")[0];
    image.style.width = `${parseInt(image.style.width) * zoomOutFactor}px`;
    image.style.height = `${parseInt(image.style.height) * zoomOutFactor}px`;
  })

  gridDimension.width *= zoomOutFactor;
  grid.style.width = `${gridDimension.width}px`;

  gridDimension.height *= zoomOutFactor;
  grid.style.height = `${gridDimension.height}px`;

  // console.log(grid.style.width);
  // console.log(grid.style.height);
}

function zoomIn() {

  Array.from(gridSections).forEach((gridSection, index) => {

    gridSection.style.left = `${parseInt(gridSection.style.left) * zoomInFactor}px`;
    gridSection.style.top = `${parseInt(gridSection.style.top) * zoomInFactor}px`;
    gridSection.style.width = `${parseInt(gridSection.style.width) * zoomInFactor}px`;
    gridSection.style.height = `${parseInt(gridSection.style.height) * zoomInFactor}px`;

    image = gridSection.getElementsByClassName("image")[0];
    image.style.width = `${parseInt(image.style.width) * zoomInFactor}px`;
    image.style.height = `${parseInt(image.style.height) * zoomInFactor}px`;
  })

  gridDimension.width *= zoomInFactor;
  grid.style.width = `${gridDimension.width}px`;

  gridDimension.height *= zoomInFactor;
  grid.style.height = `${gridDimension.height}px`;

  // console.log(grid.style.width);
  // console.log(grid.style.height);
}


/*
let lastGroupPositionX = 0;
let lastGroupPositionY = 0;
let lastGroupId = 0;

objects.forEach((object, index) => {
  const objectDiv = document.createElement("div");
  objectDiv.classList.add("object");

  //const positionX = 0;
  //const positionY = 0;
  
  const positionX = Math.floor(Math.random() * 80);
  const positionY = Math.floor(Math.random() * 80);
  
  //objectDiv.style.backgroundImage = `url(${object.image})`;
  objectDiv.style.backgroundColor = '#' + object.color;
  objectDiv.style.width = '50px';
  objectDiv.style.height = '50px';
  objectDiv.style.top = `${positionX}px`;
  objectDiv.style.left = `${positionY}px`;
  
  console.log(`${object.groupId}`);
  console.log(`${positionX} ${positionY}`);
  console.log(`${objectDiv.style.width} ${objectDiv.style.height}`);
  
  container.appendChild(objectDiv);
});
*/

/*
function ungroupObjects() {
  Array.from(container.children).forEach((object, index) => {
    console.log(object);
  })
}
*/