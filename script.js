var svg = document.getElementsByTagName('svg')[0];

var baseLayer                  = document.getElementById('base-layer');
var coverageLayer              = document.getElementById('coverage-layer');
var multiLaserLinesLayer       = document.getElementById('multi-laser-lines-layer');
var reflectedLaserOriginsLayer = document.getElementById('reflected-laser-origins-layer');

var laserSource = document.getElementsByClassName('laser-source')[0];
var laserLine = document.getElementById('laser-line');

var laserAngle = Math.PI;
var laserPosition = {x: 1700, y: 600};
var isLaserSpinning = false;
var isDraggingLaser = false;

var mirrors = [];

var nextSweptAreaGradientId = 1;

var heatmap = document.getElementById('heatmap');
var heatmapCanvasContext = heatmap.getContext('2d');

var heatmapResolutionX = parseInt(heatmap.getAttribute('width'));
var heatmapResolutionY = parseInt(heatmap.getAttribute('height'));

var multiLaserLineCount = 200;

var cursorDebugPoint = addDebugPoint(baseLayer, {x:0, y: 0});

function updateHeatmap() {
  
  if (heatmap.classList.contains('hidden')) {
    return;
  }
  
  var separationAngleThreshold = Math.PI / 8;
  
  for (var y=0; y<heatmapResolutionY; y++) {
    for (var x=0; x<heatmapResolutionX; x++) {
      var worldPosition = {
        x: (x / heatmapResolutionX) * document.body.clientWidth,
        y: (y / heatmapResolutionY) * document.body.clientHeight,
      }
      
      var value = 0;
      
      var mirrorsInRange = mirrors.filter(function(mirror) {
        if (!whichSideOfLine(mirror, worldPosition)) {
          return false;
        }
        if (whichSideOfLine({start: mirror.reflectedLaserOrigin, end: mirror.start}, worldPosition)) {
          return false;
        }
        if (!whichSideOfLine({start: mirror.reflectedLaserOrigin, end: mirror.end}, worldPosition)) {
          return false;
        }
        return true;
      });
      
      var laserOrigins = [laserPosition];
      mirrorsInRange.forEach(function(mirror) {
        laserOrigins.push(mirror.reflectedLaserOrigin);
      });
      
      var bestScore = null;
      
      laserOrigins.forEach(function(laserOrigin1) {
        laserOrigins.forEach(function(laserOrigin2) {
          if (laserOrigin1 === laserOrigin2) {
            return;
          }
          var vectorToOrigin1 = subtract(worldPosition, laserOrigin1);
          var vectorToOrigin2 = subtract(worldPosition, laserOrigin2);
          
          var angleBetweenOrigins = Math.acos(dotProduct(normalized(vectorToOrigin1), normalized(vectorToOrigin2)));
          
          var score = angleBetweenOrigins;
          if (score > (Math.PI / 2)) { // 90 degrees
            score = Math.PI - score;
          }
          
          if (!bestScore || (score > bestScore)) {
            bestScore = score;
          }
        });
      });
      
      setPixelOnCanvas(heatmapCanvasContext, x, y, {r: 255, g: 0, b: 0, a: 200 * (bestScore / Math.PI)});
    }
  }
}

window.addEventListener('resize', function() {
  updateHeatmap();
});

function createMirror(start, end, options) {
  var mirror = {};
  
  mirror.lineElement = document.createElementNS(svgNS, 'line');
  mirror.lineElement.setAttributeNS(null, 'class', 'mirror');
  baseLayer.appendChild(mirror.lineElement);
  
  mirror.reflectedLaserOriginElement = document.createElementNS(svgNS, 'circle');
  mirror.reflectedLaserOriginElement.setAttributeNS(null, 'class', 'reflected-laser-origin');
  mirror.reflectedLaserOriginElement.setAttributeNS(null, 'r', '5');
  mirror.reflectedLaserOriginNormalElement = document.createElementNS(svgNS, 'line');
  mirror.reflectedLaserOriginNormalElement.setAttributeNS(null, 'class', 'reflected-laser-origin-normal');
  reflectedLaserOriginsLayer.appendChild(mirror.reflectedLaserOriginElement);
  reflectedLaserOriginsLayer.appendChild(mirror.reflectedLaserOriginNormalElement);
  
  if (options.draggable) {
  
    mirror.handleStart = document.createElementNS(svgNS, 'circle');
    mirror.handleStart.setAttributeNS(null, 'class', 'mirror-handle');
    mirror.handleStart.setAttributeNS(null, 'r', '8');
    baseLayer.appendChild(mirror.handleStart);
    
    mirror.handleEnd = document.createElementNS(svgNS, 'circle');
    mirror.handleEnd.setAttributeNS(null, 'class', 'mirror-handle');
    mirror.handleEnd.setAttributeNS(null, 'r', '8');
    baseLayer.appendChild(mirror.handleEnd);
    
    setupDragging(mirror.handleStart, {
      start: function(cursorBeforeDrag) {
        mirror.startBeforeDrag = mirror.start;
      },
      move: function(cursorDelta) {
        mirror.update({x: mirror.startBeforeDrag.x + cursorDelta.x, y: mirror.startBeforeDrag.y + cursorDelta.y}, mirror.end);
        updateHeatmap();
        updateLaserLine();
        updateMultiLaserLines();
      }
    });
    
    setupDragging(mirror.handleEnd, {
      start: function(cursorBeforeDrag) {
        mirror.endBeforeDrag = mirror.end;
      },
      move: function(cursorDelta) {
        mirror.update(mirror.start, {x: mirror.endBeforeDrag.x + cursorDelta.x, y: mirror.endBeforeDrag.y + cursorDelta.y});
        updateHeatmap();
        updateLaserLine();
        updateMultiLaserLines();
      }
    });
  }
  
  mirror.sweepGradient = document.createElementNS(svgNS, 'radialGradient');
  mirror.sweepGradient.setAttributeNS(null, 'id', 'sweptAreaGradient' + nextSweptAreaGradientId);
  mirror.sweepGradient.setAttributeNS(null, 'gradientUnits', 'userSpaceOnUse');
  coverageLayer.appendChild(mirror.sweepGradient);
  
  mirror.sweptArea = document.createElementNS(svgNS, 'path');
  mirror.sweptArea.setAttributeNS(null, 'class', 'swept-area');
  mirror.sweptArea.setAttributeNS(null, 'fill', 'url(#sweptAreaGradient' + nextSweptAreaGradientId + ')');
  coverageLayer.appendChild(mirror.sweptArea);
  
  var stop1 = document.createElementNS(svgNS, 'stop');
  stop1.setAttributeNS(null, 'offset', '0%');
  stop1.setAttributeNS(null, 'stop-color', 'rgba(20, 79, 255, 0.8)');
  mirror.sweepGradient.appendChild(stop1);
  var stop2 = document.createElementNS(svgNS, 'stop');
  stop2.setAttributeNS(null, 'offset', '100%');
  stop2.setAttributeNS(null, 'stop-color', 'rgba(0, 70, 204, 0)');
  mirror.sweepGradient.appendChild(stop2);
  
  nextSweptAreaGradientId++;
  
  mirror.update = function(start, end) {
    mirror.start = start;
    mirror.end = end;
    
    if (options.draggable) {
      mirror.handleStart.setAttributeNS(null, 'cx', start.x);
      mirror.handleStart.setAttributeNS(null, 'cy', start.y);
      
      mirror.handleEnd.setAttributeNS(null, 'cx', end.x);
      mirror.handleEnd.setAttributeNS(null, 'cy', end.y);
    }
    
    mirror.lineElement.setAttributeNS(null, 'x1', start.x);
    mirror.lineElement.setAttributeNS(null, 'y1', start.y);
    mirror.lineElement.setAttributeNS(null, 'x2', end.x);
    mirror.lineElement.setAttributeNS(null, 'y2', end.y);
    
    if (whichSideOfLine(mirror, laserPosition)) {
      
      var closestPoint = closestPointOnLine(mirror, laserPosition);
      var reflectedLaserOrigin = add(closestPoint, vectorTo(laserPosition, closestPoint));
      mirror.reflectedLaserOriginElement.setAttributeNS(null, 'cx', reflectedLaserOrigin.x);
      mirror.reflectedLaserOriginElement.setAttributeNS(null, 'cy', reflectedLaserOrigin.y);
      mirror.reflectedLaserOriginNormalElement.setAttributeNS(null, 'x1', reflectedLaserOrigin.x);
      mirror.reflectedLaserOriginNormalElement.setAttributeNS(null, 'y1', reflectedLaserOrigin.y);
      mirror.reflectedLaserOriginNormalElement.setAttributeNS(null, 'x2', closestPoint.x);
      mirror.reflectedLaserOriginNormalElement.setAttributeNS(null, 'y2', closestPoint.y);
      mirror.reflectedLaserOrigin = reflectedLaserOrigin;
      var sweepExtent = 1100;
      var sweptAreaPoint1 = add(reflectedLaserOrigin, multiply(normalized(vectorTo(reflectedLaserOrigin, mirror.start)), sweepExtent));
      var sweptAreaPoint2 = add(reflectedLaserOrigin, multiply(normalized(vectorTo(reflectedLaserOrigin, mirror.end)),   sweepExtent));
      mirror.sweptArea.setAttributeNS(null, 'd', 'M' + mirror.start.x + ',' + mirror.start.y + ' L ' + 
                                                sweptAreaPoint1.x + ',' + sweptAreaPoint1.y + ' ' +
                                                'A ' + sweepExtent + ',' + sweepExtent + ' 0 0 0 ' + 
                                                sweptAreaPoint2.x + ',' + sweptAreaPoint2.y + ' L ' +
                                                mirror.end.x + ',' + mirror.end.y);
      
      mirror.sweepGradient.setAttributeNS(null, 'cx', reflectedLaserOrigin.x);
      mirror.sweepGradient.setAttributeNS(null, 'cy', reflectedLaserOrigin.y);
      mirror.sweepGradient.setAttributeNS(null, 'fx', reflectedLaserOrigin.x);
      mirror.sweepGradient.setAttributeNS(null, 'fy', reflectedLaserOrigin.y);
      mirror.sweepGradient.setAttributeNS(null, 'r', sweepExtent);
      
      mirror.reflectedLaserOriginElement.classList.remove('hidden');
      mirror.reflectedLaserOriginNormalElement.classList.remove('hidden');
      mirror.sweepGradient.classList.remove('hidden');
    } else {
      mirror.reflectedLaserOriginElement.classList.add('hidden');
      mirror.reflectedLaserOriginNormalElement.classList.add('hidden');
      mirror.sweepGradient.classList.add('hidden');
    }
  }
  
  mirror.update(start, end);
  
  mirrors.push(mirror);
  
  return mirror;
}

createMirror({x: 600, y: 200}, {x: 1700, y: 600}, {draggable: true});

var spinningMirrors = [];
var spinningMirrorsAngle = 0;
var spinningMirrorsPosition = {x: 410, y: 600};
var spinningMirrorsRadius = 30;
for (var i=0; i<4; i++) {
  spinningMirrors.push(createMirror({x: 10, y: 10}, {x: 20, y: 20}, {draggable: false}));
}
var spinningMirrorAngleInterval = (Math.PI * 2) / spinningMirrors.length;
var spinningMirrorsRotationMarker = document.createElementNS(svgNS, 'line');
spinningMirrorsRotationMarker.setAttributeNS(null, 'class', 'laser-line');
baseLayer.appendChild(spinningMirrorsRotationMarker);

function updateSpinningMirrors() {
  var rotationMarkerPosition = add(spinningMirrorsPosition, multiply(vectorAtAngle(spinningMirrorsAngle), spinningMirrorsRadius));
  spinningMirrorsRotationMarker.setAttributeNS(null, 'x1', spinningMirrorsPosition.x);
  spinningMirrorsRotationMarker.setAttributeNS(null, 'y1', spinningMirrorsPosition.y);
  spinningMirrorsRotationMarker.setAttributeNS(null, 'x2', rotationMarkerPosition.x);
  spinningMirrorsRotationMarker.setAttributeNS(null, 'y2', rotationMarkerPosition.y);
  spinningMirrors.forEach(function(mirror, index) {
    var mirrorNormal = vectorAtAngle(spinningMirrorsAngle + (spinningMirrorAngleInterval * index));
    var mirrorCenter = multiply(mirrorNormal, spinningMirrorsRadius);
    var mirrorStartVector = add(mirrorCenter, multiply(perpendicular(mirrorNormal),         spinningMirrorsRadius));
    var mirrorEndVector   = add(mirrorCenter, multiply(negate(perpendicular(mirrorNormal)), spinningMirrorsRadius));
    mirror.update(add(spinningMirrorsPosition, mirrorStartVector), add(spinningMirrorsPosition, mirrorEndVector));
  });
}

updateHeatmap();

var isDisplayingCoverage = false;
var coverageToggle = document.getElementById('coverage-toggle');
coverageToggle.classList.add('on');
coverageToggle.addEventListener('change', function() {
  isDisplayingCoverage = coverageToggle.checked;
  coverageLayer.classList.toggle('hidden', !isDisplayingCoverage);
});

var isDisplayingHeatmap = false;
var heatmapToggle = document.getElementById('heatmap-toggle');
heatmapToggle.classList.add('off');
heatmapToggle.addEventListener('change', function() {
  isDisplayingHeatmap = heatmapToggle.checked;
  heatmap.classList.toggle('hidden', !isDisplayingHeatmap);
  updateHeatmap();
});

var laserSpinToggle = document.getElementById('laser-spin-toggle');
laserSpinToggle.classList.add('off');
laserSpinToggle.addEventListener('change', function() {
  isLaserSpinning = laserSpinToggle.checked;
});

var isDisplayingReflectedLaserOrigins = true;
var reflectedLaserOriginsToggle = document.getElementById('reflected-laser-origins-toggle');
reflectedLaserOriginsToggle.classList.add('on');
reflectedLaserOriginsToggle.addEventListener('change', function() {
  isDisplayingReflectedLaserOrigins = reflectedLaserOriginsToggle.checked;
  reflectedLaserOriginsLayer.classList.toggle('hidden', !isDisplayingReflectedLaserOrigins);
});

var isDisplayingMultiLaserLines = false;
var multiLaserLinesToggle = document.getElementById('multi-laser-lines-toggle');
multiLaserLinesToggle.classList.add('off');
multiLaserLinesToggle.addEventListener('change', function() {
  isDisplayingMultiLaserLines = multiLaserLinesToggle.checked;
  multiLaserLinesSlider.set('disabled', !isDisplayingMultiLaserLines);
  if (isDisplayingMultiLaserLines) {
    updateMultiLaserLines();
  }
  multiLaserLinesLayer.classList.toggle('hidden', !isDisplayingMultiLaserLines);
});

var multiLaserLinesSlider = document.getElementById('multi-laser-lines-slider');
multiLaserLinesSlider.set('value', multiLaserLineCount);
multiLaserLinesSlider.addEventListener('immediate-value-changed', function() {
  multiLaserLineCount = multiLaserLinesSlider.immediateValue;
  updateMultiLaserLines();
});

var spinningMirrorsRadiusSlider = document.getElementById('spinning-mirrors-radius');
spinningMirrorsRadiusSlider.set('value', spinningMirrorsRadius);
spinningMirrorsRadiusSlider.addEventListener('immediate-value-changed', function() {
  spinningMirrorsRadius = spinningMirrorsRadiusSlider.immediateValue;
  updateSpinningMirrors();
  updateLaserLine();
  updateMultiLaserLines();
});

var laserSourceBeforeDrag = null;
setupDragging(laserSource, {
  start: function() {
    laserSourceBeforeDrag = laserPosition;
  },
  move: function(cursorDelta) {
    laserPosition = {x: laserSourceBeforeDrag.x + cursorDelta.x, y: laserSourceBeforeDrag.y + cursorDelta.y};
    laserSource.setAttributeNS(null, 'cx', laserPosition.x);
    laserSource.setAttributeNS(null, 'cy', laserPosition.y);
    mirrors.forEach(function(mirror) {
      mirror.update(mirror.start, mirror.end);
    });
    updateHeatmap();
    updateLaserLine();
    updateMultiLaserLines();
  }
});

function generateLaserPath(position, angle) {
  
  var laserVector = vectorAtAngle(laserAngle);
  
  var laserPoints = [{
    position: position,
    vector: laserVector,
    mirror: null,
  }]
  for (var i=0; i<10; i++) {
    var nextPoint = findNextLaserPoint(laserPoints[laserPoints.length-1]);
    laserPoints.push(nextPoint);
    if (!nextPoint.vector) {
      break;
    }
  }
  
  mirrors.forEach(function(mirror) {
    mirror.lineElement.classList.remove('hit');
  });
  
  var pathString = '';
  laserPoints.forEach(function(laserPoint) {
    pathString += laserPoint.position.x + ',' + laserPoint.position.y + ' '
    if (laserPoint.mirror) {
      laserPoint.mirror.lineElement.classList.add('hit');
    }
  });
  
  return pathString;
}

function updateLaserLine() {
  var pathString = generateLaserPath(laserPosition, laserAngle);
  laserLine.setAttributeNS(null, 'points', pathString);
}

updateLaserLine();

var multiLaserLines = [];

function updateMultiLaserLines() {

  if (multiLaserLines.length != multiLaserLineCount) {
    multiLaserLines.forEach(function(multiLaserLine) {
      multiLaserLine.remove();
    });
    multiLaserLines = [];

    for (var i=0; i<multiLaserLineCount; i++) {
      var multiLaserLine = document.createElementNS(svgNS, 'polyline');
      multiLaserLine.setAttributeNS(null, 'class', 'laser-line');
      multiLaserLinesLayer.appendChild(multiLaserLine);
      multiLaserLines.push(multiLaserLine);
    }
  }

  var rotationRange = Math.PI / 2;

  var spinningMirrorsAngleBefore = spinningMirrorsAngle;
  if (isDisplayingMultiLaserLines) {
    multiLaserLines.forEach(function(multiLaserLine, index) {
      spinningMirrorsAngle = rotationRange * (index / multiLaserLineCount);
      updateSpinningMirrors();
      var multiPathString = generateLaserPath(laserPosition, laserAngle);
      multiLaserLine.setAttributeNS(null, 'points', multiPathString);
    });
  }
  spinningMirrorsAngle = spinningMirrorsAngleBefore;
}

function findNextLaserPoint(currentPoint) {
  var nextPosition = add(currentPoint.position, multiply(currentPoint.vector, 10000));
  var nextVector = null;
  var hitMirror = null;
  mirrors.forEach(function(mirror) {
    if (currentPoint.mirror && currentPoint.mirror === mirror) {
      return;
    }
    
    // Using ray-line intersection technique from http://stackoverflow.com/a/14318254/1933312
    var result = lineIntersection({start: currentPoint.position, end: add(currentPoint.position, currentPoint.vector)}, mirror);
    var intersects = (result.t > 0) && (result.u >= 0 && result.u <= 1);
    if (intersects) {
      var hitPoint = add(currentPoint.position, multiply(currentPoint.vector, result.t));
      
      var mirrorVector = vectorTo(mirror.start, mirror.end);
      var mirrorNormal = normalized({x: -mirrorVector.y, y: mirrorVector.x});
      
      var incidentVector = vectorTo(currentPoint.position, hitPoint);
      var reflectionVector = reflect(incidentVector, mirrorNormal);
      
      if (!nextVector || (lengthBetween(currentPoint.position, hitPoint) < lengthBetween(currentPoint.position, nextPosition))) {
        nextPosition = hitPoint;
        if (whichSideOfLine(mirror, currentPoint.position)) {
          nextVector = normalized(reflectionVector);
        }
        hitMirror = mirror;
      }
    }
  });
  
  return {
    position: nextPosition,
    vector: nextVector,
    mirror: hitMirror,
  }
}

function findVisibleMirrorSegments(mirrors, vantagePoint) {
  var localizedMirrors = [];
  mirrors.forEach(function(mirror) {
    var vectorToStart = vectorTo(vantagePoint, mirror.start);
    var vectorToEnd   = vectorTo(vantagePoint, mirror.end);
    var localizedMirror = {
      start: {x: angleOfVector(vectorToStart), y: length(vectorToStart)},
      end:   {x: angleOfVector(vectorToEnd),   y: length(vectorToEnd)},
    };
    
    if (localizedMirror.start.x > localizedMirror.end.x) {
      localizedMirror = {
        start: localizedMirror.end,
        end:   localizedMirror.start,
      }
    }
    
    localizedMirrors.push(localizedMirror);
  });
  
  localizedMirrors.filter(function(localizedMirror) {
    localizedMirrors.forEach(function(otherLocalizedMirror) {
      if (localizedMirror !== otherLocalizedMirror) {
        if (otherLocalizedMirror.start.x < localizedMirror.start.x && otherLocalizedMirror.end.x > localizedMirror.end.x) {
          
        }
      }
    });
  });
}

var lastTimestamp = null;

function updateFrame(timestamp) {
  if (lastTimestamp) {
    var timeDelta = timestamp - lastTimestamp;
    
//     if (!isDraggingLaser && isLaserSpinning) {
//       laserAngle += timeDelta * 0.001;
//     }
    
    if (isLaserSpinning) {
      spinningMirrorsAngle += timeDelta * 0.001;
    }
  }
  
//   if (isLaserSpinning) {
    updateLaserLine();
//   }
  
  updateSpinningMirrors();
  
  lastTimestamp = timestamp;
  window.requestAnimationFrame(updateFrame);
}

window.addEventListener('mousedown', function(event) {
  if (event.button === 2) {
    isDraggingLaser = true;
    event.preventDefault();
    return false;
  }
});

document.addEventListener('contextmenu', function(event) {
  event.preventDefault();
});

window.addEventListener('mouseup', function() {
  isDraggingLaser = false;
});

svg.addEventListener('mousemove', function(event) {
  if (isDraggingLaser) {
    var cursor = {x: event.offsetX, y: event.offsetY};
//     laserAngle = angleTo(laserPosition, cursor);
    spinningMirrorsAngle = angleTo(spinningMirrorsPosition, cursor);
    
    var angleToCursor = angleTo(spinningMirrorsPosition, cursor);
    var angleToLaser  = angleTo(spinningMirrorsPosition, laserPosition);
    var reflectionAngle = angleToCursor + ((angleToLaser - angleToCursor) / 2);
    
//     spinningMirrorsAngle = reflectionAngle;
//     spinningMirrorsAngle = reflectionAngle - (angleOfVector({x: lengthBetween(cursor, spinningMirrorsPosition), y: spinningMirrorsRadius}) * (spinningMirrorsAngle / (Math.PI/2)));
    
    cursorDebugPoint.setAttributeNS(null, 'cx', cursor.x);
    cursorDebugPoint.setAttributeNS(null, 'cy', cursor.y);
  }
});

window.requestAnimationFrame(updateFrame);
