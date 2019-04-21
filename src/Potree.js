// no-ui -- 1 -- 3

window.Potree = function(){

};

Potree = window.Potree;

Potree.version = {
	major: 1,
	minor: 5,
	suffix: "RC"
};

// console.log("Potree " + Potree.version.major + "." + Potree.version.minor + Potree.version.suffix);

Potree.pointBudget = 1*1000*1000;

Potree.framenumber = 0;

// contains WebWorkers with base64 encoded code
//Potree.workers = {};

Potree.Shaders = {};

Potree.webgl = {
	shaders: {},
	vaos: {},
	vbos: {}
};

/*
Potree.scriptPath = null;
if(document.currentScript.src){
		Potree.scriptPath = new URL(document.currentScript.src + "/..").href;
        if (Potree.scriptPath.slice(-1) === '/') {
            Potree.scriptPath = Potree.scriptPath.slice(0, -1);
        }
}else{
	console.error("Potree was unable to find its script path using document.currentScript. Is Potree included with a script tag? Does your browser support this function?");
}
*/

if (window['__POTREE_DEMO__']) {
	console.log ('DEMO MODE');
    Potree.scriptPath = new URL(document.currentScript.src + "/..").href;
    if (Potree.scriptPath.slice(-1) === '/') {
        Potree.scriptPath = Potree.scriptPath.slice(0, -1);
    }
} else {

    Potree.scriptPath = window.location.origin + "/assets/potree";
}

Potree.resourcePath = Potree.scriptPath + "/resources";

console.log ('Portree running with resourcePath: ' , Potree.resourcePath );

Potree.timerQueries = {};

Potree.timerQueriesEnabled = false;

Potree.startQuery = function(name, gl){
	if(!Potree.timerQueriesEnabled){
		return null;
	}

	if(Potree.timerQueries[name] === undefined){
		Potree.timerQueries[name] = [];
	}

	const ext = gl.getExtension("EXT_disjoint_timer_query");
	const query = ext.createQueryEXT();
	ext.beginQueryEXT(ext.TIME_ELAPSED_EXT, query);

	Potree.timerQueries[name].push(query);

	return query;
};

Potree.endQuery = function(query, gl){
	if(!Potree.timerQueriesEnabled){
		return;
	}

	const ext = gl.getExtension("EXT_disjoint_timer_query");
	ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
};

Potree.MOUSE = {
	LEFT:   1,
	RIGHT:  2,
	MIDDLE: 3
};

Potree.Points = class Points{

	constructor(){

		this.boundingBox = new THREE.Box3();
		this.numPoints = 0;
		this.data = {};

	}

	add(points){

		const currentSize = this.numPoints;
		const additionalSize = points.numPoints;
		const newSize = currentSize + additionalSize;

		const thisAttributes = Object.keys(this.data);
		const otherAttributes = Object.keys(points.data);
		const attributes = new Set([...thisAttributes, ...otherAttributes]);

		for(let attribute of attributes){
			if(thisAttributes.includes(attribute) && otherAttributes.includes(attribute)){

				// attribute in both, merge
				let Type = this.data[attribute].constructor;
				let merged = new Type(this.data[attribute].length + points.data[attribute].length);
				merged.set(this.data[attribute], 0);
				merged.set(points.data[attribute], this.data[attribute].length);
				this.data[attribute] = merged;

			}else if(thisAttributes.includes(attribute) && !otherAttributes.includes(attribute)){

				// attribute only in this; take over this and expand to new size
				let elementsPerPoint = this.data[attribute].length / this.numPoints;
				let Type = this.data[attribute].constructor;
				let expanded = new Type(elementsPerPoint * newSize);
				expanded.set(this.data[attribute], 0);
				this.data[attribute] = expanded;

			}else if(!thisAttributes.includes(attribute) && otherAttributes.includes(attribute)){

				// attribute only in points to be added; take over new points and expand to new size
				let elementsPerPoint = points.data[attribute].length / points.numPoints;
				let Type = points.data[attribute].constructor;
				let expanded = new Type(elementsPerPoint * newSize);
				expanded.set(points.data[attribute], elementsPerPoint * currentSize);
				this.data[attribute] = expanded;

			}
		}

		this.numPoints = newSize;

		this.boundingBox.union(points.boundingBox);
	}

};


Potree.loadPointCloud = function(path, name, callback, urlMiddleWare){

	Potree._middleWare = urlMiddleWare;


	const loaded = function(pointcloud){
		pointcloud.name = name;

		callback({type: "pointcloud_loaded", pointcloud: pointcloud});
	};

	// load pointcloud
	if(!path){

	}else if(path.indexOf("greyhound://") === 0){
		// We check if the path string starts with 'greyhound:', if so we assume it's a greyhound server URL.
		Potree.GreyhoundLoader.load(path, function(geometry) {
			if(!geometry){
				callback({type: "loading_failed"});
			}else{
				let pointcloud = new Potree.PointCloudOctree(geometry);
				loaded(pointcloud);
			}
		});
	}else if(path.indexOf("cloud.js") > 0){
		Potree.POCLoader.load(path, function(geometry){

			if(!geometry){
				callback({type: "loading_failed"});
			}else{
				let pointcloud = new Potree.PointCloudOctree(geometry);

				loaded(pointcloud);
			}
		}.bind(this), urlMiddleWare);
	}else if(path.indexOf(".vpc") > 0){
		Potree.PointCloudArena4DGeometry.load(path, function(geometry){
			if(!geometry){
				callback({type: "loading_failed"});
			}else{
				let pointcloud = new Potree.PointCloudArena4D(geometry);
				loaded(pointcloud);
			}
		});
	}else{
		callback({"type": "loading_failed"});
	}
};

Potree.updatePointClouds = function(pointclouds, camera, renderer){

	if(!Potree.lru){
		Potree.lru = new LRU();
	}

	for(let i = 0; i < pointclouds.length; i++){
		let pointcloud = pointclouds[i];
		for(let j = 0; j < pointcloud.profileRequests.length; j++){
			pointcloud.profileRequests[j].update();
		}
	}

	let result = Potree.updateVisibility(pointclouds, camera, renderer);

	for(let i = 0; i < pointclouds.length; i++){
		let pointcloud = pointclouds[i];
		pointcloud.updateMaterial(pointcloud.material, pointcloud.visibleNodes, camera, renderer);
		pointcloud.updateVisibleBounds();
	}

	Potree.getLRU().freeMemory();

	return result;
};

Potree.getLRU = function(){
	if(!Potree.lru){
		Potree.lru = new LRU();
	}

	return Potree.lru;
};


function updateVisibilityStructures(pointclouds, camera){
	const frustums = [];
	const camObjPositions = [];
	const priorityQueue = new BinaryHeap(function(x){return 1 / x.weight;});

	for(let i = 0; i < pointclouds.length; i++){
		let pointcloud = pointclouds[i];

		if(!pointcloud.initialized()){
			continue;
		}

		pointcloud.numVisibleNodes = 0;
		pointcloud.numVisiblePoints = 0;
		pointcloud.deepestVisibleLevel = 0;
		pointcloud.visibleNodes = [];
		pointcloud.visibleGeometry = [];

		// frustum in object space
		camera.updateMatrixWorld();
		let frustum = new THREE.Frustum();
		let viewI = camera.matrixWorldInverse;
		let world = pointcloud.matrixWorld;
		let proj = camera.projectionMatrix;
		let fm = new THREE.Matrix4().multiply(proj).multiply(viewI).multiply(world);
		frustum.setFromMatrix( fm );
		frustums.push(frustum);

		// camera position in object space
		let view = camera.matrixWorld;
		let worldI = new THREE.Matrix4().getInverse(world);
		let camMatrixObject = new THREE.Matrix4().multiply(worldI).multiply(view);
		let camObjPos = new THREE.Vector3().setFromMatrixPosition( camMatrixObject );
		camObjPositions.push(camObjPos);

		if(pointcloud.visible && pointcloud.root !== null){
			priorityQueue.push({pointcloud: i, node: pointcloud.root, weight: Number.MAX_VALUE});
		}

		if(pointcloud.root.isTreeNode()){
			pointcloud.hideDescendants(pointcloud.root.sceneNode);
		}

		for(let j = 0; j < pointcloud.boundingBoxNodes.length; j++){
			pointcloud.boundingBoxNodes[j].visible = false;
		}
	}

	return {
		"frustums": frustums,
		"camObjPositions" : camObjPositions,
		"priorityQueue": priorityQueue
	};
}

Potree.getDEMWorkerInstance = function(){
	if(!Potree.DEMWorkerInstance){
		let workerPath = Potree.scriptPath + "/workers/DEMWorker.js";
		Potree.DEMWorkerInstance = Potree.workerPool.getWorker(workerPath);
	}

	return Potree.DEMWorkerInstance;
}

Potree.updateVisibility = function(pointclouds, camera, renderer){
	let numVisibleNodes = 0;
	let numVisiblePoints = 0;

	let visibleNodes = [];
	let visibleGeometry = [];
	let unloadedGeometry = [];

	let lowestSpacing = Infinity;

	// calculate object space frustum and cam pos and setup priority queue
	let s = updateVisibilityStructures(pointclouds, camera, renderer);
	let frustums = s.frustums;
	let camObjPositions = s.camObjPositions;
	let priorityQueue = s.priorityQueue;

	let loadedToGPUThisFrame = 0;

	while(priorityQueue.size() > 0){
		let element = priorityQueue.pop();
		let node = element.node;
		let parent = element.parent;
		let pointcloud = pointclouds[element.pointcloud];

		let box = node.getBoundingBox();
		let frustum = frustums[element.pointcloud];
		let camObjPos = camObjPositions[element.pointcloud];

		let insideFrustum = frustum.intersectsBox(box);
		let maxLevel = pointcloud.maxLevel || Infinity;
		let level = node.getLevel();
		let visible = insideFrustum;
		visible = visible && !(numVisiblePoints + node.getNumPoints() > Potree.pointBudget);
		visible = visible && level < maxLevel;

		if (pointcloud.material.numClipBoxes > 0 && visible && pointcloud.material.clipMode === Potree.ClipMode.CLIP_OUTSIDE) {
			let box2 = box.clone();
			pointcloud.updateMatrixWorld(true);
			box2.applyMatrix4(pointcloud.matrixWorld);
			let intersectsClipBoxes = false;
			for(let clipBox of pointcloud.material.clipBoxes) {
				let clipMatrixWorld = clipBox.matrix;
				let clipBoxWorld = new THREE.Box3(
						new THREE.Vector3(-0.5, -0.5, -0.5),
						new THREE.Vector3(0.5, 0.5, 0.5))
					.applyMatrix4(clipMatrixWorld);
				if (box2.intersectsBox(clipBoxWorld)) {
					intersectsClipBoxes = true;
					break;
				}
			}
			visible = visible && intersectsClipBoxes;
		}


		if(node.spacing){
			lowestSpacing = Math.min(lowestSpacing, node.spacing);
		}else if(node.geometryNode && node.geometryNode.spacing){
			lowestSpacing = Math.min(lowestSpacing, node.geometryNode.spacing);
		}

		if(numVisiblePoints + node.getNumPoints() > Potree.pointBudget){
			break;
		}


		if(!visible){
			continue;
		}

		numVisibleNodes++;
		numVisiblePoints += node.getNumPoints();

		pointcloud.numVisibleNodes++;
		pointcloud.numVisiblePoints += node.getNumPoints();

		if(node.isGeometryNode() && (!parent || parent.isTreeNode())){
			if(node.isLoaded() && loadedToGPUThisFrame < 2){
				node = pointcloud.toTreeNode(node, parent);
				loadedToGPUThisFrame++;
			}else{
				unloadedGeometry.push(node);
				visibleGeometry.push(node);
			}
		}

		if(node.isTreeNode()){
			Potree.getLRU().touch(node.geometryNode);
			node.sceneNode.visible = true;
			node.sceneNode.material = pointcloud.material;

			visibleNodes.push(node);
			pointcloud.visibleNodes.push(node);

			node.sceneNode.updateMatrix();
			node.sceneNode.matrixWorld.multiplyMatrices( pointcloud.matrixWorld, node.sceneNode.matrix );

			if(pointcloud.showBoundingBox && !node.boundingBoxNode && node.getBoundingBox){
				let boxHelper = new Potree.Box3Helper(node.getBoundingBox());
				//let boxHelper = new THREE.BoxHelper(node.sceneNode);
				pointcloud.add(boxHelper);
				pointcloud.boundingBoxNodes.push(boxHelper);
				node.boundingBoxNode = boxHelper;
				node.boundingBoxNode.matrixWorld.copy(pointcloud.matrixWorld);
			}else if(pointcloud.showBoundingBox){
				node.boundingBoxNode.visible = true;
				node.boundingBoxNode.matrixWorld.copy(pointcloud.matrixWorld);
			}else if(!pointcloud.showBoundingBox && node.boundingBoxNode){
				node.boundingBoxNode.visible = false;
			}

		}

		// add child nodes to priorityQueue
		let children = node.getChildren();
		for(let i = 0; i < children.length; i++){
			let child = children[i];

			let sphere = child.getBoundingSphere();
			let distance = sphere.center.distanceTo(camObjPos);
			let radius = sphere.radius;

			let fov = (camera.fov * Math.PI) / 180;
			let slope = Math.tan(fov / 2);
			let projFactor = (0.5 * renderer.domElement.clientHeight) / (slope * distance);
			let screenPixelRadius = radius * projFactor;

			if(screenPixelRadius < pointcloud.minimumNodePixelSize){
				continue;
			}

			let weight = screenPixelRadius;

			if(distance - radius < 0){
				weight = Number.MAX_VALUE;
			}

			priorityQueue.push({pointcloud: element.pointcloud, node: child, parent: node, weight: weight});
		}


	}// end priority queue loop

	{ // update DEM
		let maxDEMLevel = 4;
		let candidates = pointclouds
			.filter(p => (p.generateDEM && p.dem instanceof Potree.DEM));
		for(let pointcloud of candidates){
			let updatingNodes = pointcloud.visibleNodes.filter(n => n.getLevel() <= maxDEMLevel);
			pointcloud.dem.update(updatingNodes);
		}
	}

	for(let i = 0; i < Math.min(5, unloadedGeometry.length); i++){
		unloadedGeometry[i].load();
	}


	return {
		visibleNodes: visibleNodes,
		numVisiblePoints: numVisiblePoints,
		lowestSpacing: lowestSpacing
	};
};
