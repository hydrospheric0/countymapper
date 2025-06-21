// Initialize map
var map = L.map('map', {
  center: [39.8283, -98.5795],
  zoom: 10
});

// Base layers
var baseLayers = {
  'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }),
  'CartoDB Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors & CartoDB'
  }),
  'Esri Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri'
  })
};

// Add default base layer
baseLayers['CartoDB Light'].addTo(map);

// County boundary layer group
var countyBoundaryGroup = L.layerGroup();

// Add Counties layer to map by default
countyBoundaryGroup.addTo(map);

// Layer control - visible by default
L.control.layers(baseLayers, {
  'Counties': countyBoundaryGroup
}, {collapsed: false}).addTo(map);

var countyBoundaryLoaded = false;
var locationMarker = null;
var statusDiv = document.getElementById('status');
var currentMainCountyId = null; // Track which county is currently highlighted
var allCountiesData = null; // Store all county data for switching
var stateInfo = null; // Store state info
var userLocation = null; // Store user's location for label positioning
var countyLabels = []; // Track all county label for repositioning
var countyFeatureLayers = []; // Store references to individual county feature layers

function updateStatus(message) {
  statusDiv.textContent = message;
}

// Update all county label positions when map moves
function updateCountyLabelPositions() {
  if (!countyFeatureLayers || countyFeatureLayers.length === 0) {
    return;
  }
  
  // Remove ALL existing labels
  countyLabels.forEach(function(label) {
    if (map.hasLayer(label)) {
      map.removeLayer(label);
    }
  });
  countyLabels = [];
  
  // Get current map bounds
  var mapBounds = map.getBounds();
  
  // Create labels for visible counties
  countyFeatureLayers.forEach(function(featureLayer) {
    if (featureLayer.labelTemplate) {
      var countyName = featureLayer.labelTemplate.countyName;
      var countyId = featureLayer.labelTemplate.countyId;
      var countyBounds = featureLayer.getBounds();
      
      // Only create label if county is visible and majority of area is visible
      if (mapBounds.intersects(countyBounds) && getVisibleAreaRatio(featureLayer) > 0.5) {
        var labelPosition = getBestLabelPosition(featureLayer, countyId);
        
        // Skip if getBestLabelPosition returned null (county not visible in current view)
        if (!labelPosition) {
          return;
        }
        
        var isMainCounty = countyId === currentMainCountyId;
        
        // Responsive sizing for mobile devices
        var isMobile = window.innerWidth <= 768;
        var isSmallMobile = window.innerWidth <= 480;
        
        var fontSize = isSmallMobile ? '16px' : (isMobile ? '14px' : (isMainCounty ? '13px' : '12px'));
        var padding = isSmallMobile ? '6px 14px' : (isMobile ? '5px 12px' : (isMainCounty ? '4px 10px' : '3px 8px'));
        var iconWidth = isSmallMobile ? 150 : (isMobile ? 140 : 130);
        var iconHeight = isSmallMobile ? 32 : (isMobile ? 28 : 26);
        
        var labelStyle = `color: #000; font-size: ${fontSize}; font-weight: bold; text-align: center; padding: ${padding}; background: none; border: none; box-shadow: none;`;
        
        var label = L.marker(labelPosition, {
          icon: L.divIcon({
            className: 'county-label',
            html: `<div style="${labelStyle}" data-county="${countyId}">${countyName}</div>`,
            iconSize: [iconWidth, iconHeight],
            iconAnchor: [iconWidth/2, iconHeight/2]
          })
        });
        
        // Store county information on the label for debugging
        label._countyId = countyId;
        label._countyName = countyName;
        
        // Make clickable
        label.on('click', function(e) {
          e.originalEvent.stopPropagation();
          switchMainCounty(countyId);
        });
        
        map.addLayer(label);
        countyLabels.push(label);
      }
    }
  });
}

// Add map event listeners for immediate label repositioning
map.on('moveend', function() {
  updateCountyLabelPositions();
});

map.on('zoomend', function() {
  updateCountyLabelPositions();
});

// Get styling for county based on whether it's the main county
function getCountyStyle(isMainCounty) {
  return {
    color: isMainCounty ? "#8A2BE2" : "#666666",
    weight: isMainCounty ? 3 : 2,
    opacity: isMainCounty ? 0.9 : 0.6,
    fillOpacity: isMainCounty ? 0.15 : 0.05,
    fillColor: isMainCounty ? "#8A2BE2" : "#666666"
  };
}

// Place label within 10% of border, floating toward map center, only if majority visible
function getBestLabelPosition(layer, countyId) {
  var countyBounds = layer.getBounds();
  var mapBounds = map.getBounds();

  // 1. Only show labels for counties where the majority of the polygon is visible
  if (getVisibleAreaRatio(layer) <= 0.5) return null;

  // 2. Never overlap the location marker
  var avoidLocation = null;
  if (window.userLocation && window.userLocation.lat && window.userLocation.lng) {
    avoidLocation = L.latLng(window.userLocation.lat, window.userLocation.lng);
  }
  var minDistanceMeters = 60;
  var isMobile = window.innerWidth <= 768;

  // 3. Always place the label inside the visible part of the polygon
  var countyBounds = layer.getBounds();
  var viewSouth = Math.max(countyBounds.getSouth(), mapBounds.getSouth());
  var viewNorth = Math.min(countyBounds.getNorth(), mapBounds.getNorth());
  var viewWest = Math.max(countyBounds.getWest(), mapBounds.getWest());
  var viewEast = Math.min(countyBounds.getEast(), mapBounds.getEast());
  if (viewSouth >= viewNorth || viewWest >= viewEast) return null;

  // 4. Calculate minimum boundary distance (30% of visible bbox to ensure labels stay well inside)
  var minBoundaryDistMeters = Math.min(
    map.distance([viewSouth, viewWest], [viewNorth, viewWest]),
    map.distance([viewSouth, viewWest], [viewSouth, viewEast])
  ) * 0.30;

  // 5. Thorough spiral search from map center: evaluate all rules point by point
  var mapCenter = map.getCenter();
  var centerLat = mapCenter.lat;
  var centerLng = mapCenter.lng;
  var step = Math.max((viewNorth - viewSouth), (viewEast - viewWest)) / 120; // Finer grid
  var maxRadius = Math.max((viewNorth - viewSouth), (viewEast - viewWest)) / 2;
  var center = L.latLng(centerLat, centerLng);
  var bestLatLng = null;
  var minDist = Infinity;

  // First try the geometric center of the county if it's valid
  var geomCenter = getCountyCenter(countyId);
  if (geomCenter) {
    var candidate = L.latLng(geomCenter.lat, geomCenter.lng);
    if (mapBounds.contains(candidate) && 
        pointInPolygon(candidate, layer) &&
        (!avoidLocation || candidate.distanceTo(avoidLocation) >= minDistanceMeters) &&
        minDistanceToPolygonBoundary(candidate, layer) >= minBoundaryDistMeters) {
      return candidate;
    }
  }

  // Spiral search with smaller angle steps for better coverage
  for (var r = 0; r <= maxRadius; r += step) {
    for (var angle = 0; angle < 360; angle += 3) { // Smaller angle steps
      var rad = angle * Math.PI / 180;
      var lat = centerLat + r * Math.cos(rad);
      var lng = centerLng + r * Math.sin(rad);
      var candidate = L.latLng(lat, lng);
      
      // Rule A: Must be within map bounds
      if (!mapBounds.contains(candidate)) continue;
      
      // Rule B: Must be inside polygon
      if (!pointInPolygon(candidate, layer)) continue;
      
      // Rule C: Must not overlap location marker (increased safety margin)
      if (avoidLocation && candidate.distanceTo(avoidLocation) < minDistanceMeters * 1.2) continue;
      
      // Rule D: Must be well inside polygon boundary
      if (minDistanceToPolygonBoundary(candidate, layer) < minBoundaryDistMeters) continue;
      
      // Rule E: Choose closest to map center
      var dist = candidate.distanceTo(center);
      if (dist < minDist) {
        bestLatLng = candidate;
        minDist = dist;
      }
    }
    if (bestLatLng) break;
  }
  
  // If no position found with strict requirements, try with reduced boundary distance
  if (!bestLatLng) {
    var reducedBoundaryDist = minBoundaryDistMeters * 0.5; // Try with 50% of original distance
    minDist = Infinity;
    
    for (var r = 0; r <= maxRadius; r += step) {
      for (var angle = 0; angle < 360; angle += 3) {
        var rad = angle * Math.PI / 180;
        var lat = centerLat + r * Math.cos(rad);
        var lng = centerLng + r * Math.sin(rad);
        var candidate = L.latLng(lat, lng);
        
        if (!mapBounds.contains(candidate)) continue;
        if (!pointInPolygon(candidate, layer)) continue;
        if (avoidLocation && candidate.distanceTo(avoidLocation) < minDistanceMeters * 1.2) continue;
        if (minDistanceToPolygonBoundary(candidate, layer) < reducedBoundaryDist) continue;
        
        var dist = candidate.distanceTo(center);
        if (dist < minDist) {
          bestLatLng = candidate;
          minDist = dist;
        }
      }
      if (bestLatLng) break;
    }
  }
  
  if (bestLatLng) return bestLatLng;

  // 6. If no valid position is found, do not show the label
  return null;
}

// Estimate the visible area ratio of a polygon in the current map view
function getVisibleAreaRatio(layer) {
  // Use a simple grid sampling approach for estimation
  var bounds = layer.getBounds();
  var mapBounds = map.getBounds();
  var minLat = Math.max(bounds.getSouth(), mapBounds.getSouth());
  var maxLat = Math.min(bounds.getNorth(), mapBounds.getNorth());
  var minLng = Math.max(bounds.getWest(), mapBounds.getWest());
  var maxLng = Math.min(bounds.getEast(), mapBounds.getEast());
  if (minLat >= maxLat || minLng >= maxLng) return 0;

  var total = 0, inside = 0;
  var steps = 10; // 10x10 grid
  for (var i = 0; i <= steps; i++) {
    var lat = minLat + (maxLat - minLat) * (i / steps);
    for (var j = 0; j <= steps; j++) {
      var lng = minLng + (maxLng - minLng) * (j / steps);
      total++;
      if (pointInPolygon(L.latLng(lat, lng), layer)) inside++;
    }
  }
  // Estimate visible area as fraction of grid points inside polygon and map view
  var polygonTotal = 0;
  for (var i = 0; i <= steps; i++) {
    var lat = bounds.getSouth() + (bounds.getNorth() - bounds.getSouth()) * (i / steps);
    for (var j = 0; j <= steps; j++) {
      var lng = bounds.getWest() + (bounds.getEast() - bounds.getWest()) * (j / steps);
      if (pointInPolygon(L.latLng(lat, lng), layer)) polygonTotal++;
    }
  }
  if (polygonTotal === 0) return 0;
  return inside / polygonTotal;
}

// Check if a point is inside a polygon using ray casting algorithm
function pointInPolygon(latLng, layer) {
  if (!latLng || !layer) return false;
  
  var lat = latLng.lat;
  var lng = latLng.lng;
  
  // Handle different layer types
  var coordinates = null;
  
  if (layer.feature && layer.feature.geometry) {
    var geom = layer.feature.geometry;
    if (geom.type === 'Polygon') {
      coordinates = geom.coordinates[0]; // Use outer ring
    } else if (geom.type === 'MultiPolygon') {
      // For MultiPolygon, check all polygons
      for (var p = 0; p < geom.coordinates.length; p++) {
        coordinates = geom.coordinates[p][0]; // Use outer ring of each polygon
        if (pointInPolygonCoords(lat, lng, coordinates)) {
          return true;
        }
      }
      return false;
    }
  } else if (layer.getLatLngs) {
    // Try to get coordinates from Leaflet layer
    var latlngs = layer.getLatLngs();
    if (latlngs && latlngs.length > 0) {
      // Handle nested arrays (Polygon vs MultiPolygon)
      if (Array.isArray(latlngs[0]) && Array.isArray(latlngs[0][0])) {
        // MultiPolygon case
        for (var p = 0; p < latlngs.length; p++) {
          coordinates = latlngs[p][0].map(function(ll) { return [ll.lng, ll.lat]; });
          if (pointInPolygonCoords(lat, lng, coordinates)) {
            return true;
          }
        }
        return false;
      } else if (Array.isArray(latlngs[0])) {
        // Polygon case
        coordinates = latlngs[0].map(function(ll) { return [ll.lng, ll.lat]; });
      }
    }
  }
  
  if (!coordinates) return false;
  
  return pointInPolygonCoords(lat, lng, coordinates);
}

// Ray casting algorithm for point-in-polygon test
function pointInPolygonCoords(lat, lng, coordinates) {
  var inside = false;
  var j = coordinates.length - 1;
  
  for (var i = 0; i < coordinates.length; i++) {
    var xi = coordinates[i][1]; // lat
    var yi = coordinates[i][0]; // lng
    var xj = coordinates[j][1]; // lat
    var yj = coordinates[j][0]; // lng
    
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
    j = i;
  }
  
  return inside;
}

// Switch the main county highlight
function switchMainCounty(newMainCountyId) {
  console.log('switchMainCounty called with:', newMainCountyId, 'current:', currentMainCountyId);
  
  if (newMainCountyId === currentMainCountyId) {
    console.log('Same county, no switch needed');
    return;
  }
  
  console.log('Switching main county from', currentMainCountyId, 'to', newMainCountyId);
  currentMainCountyId = newMainCountyId;
  
  // Update styles and positions of all county layers
  countyBoundaryGroup.eachLayer(function(layer) {
    if (layer.feature && layer.feature.properties) {
      var isMainCounty = layer.feature.properties.id === currentMainCountyId;
      
      // Use outline-only style
      layer.setStyle({
        color: isMainCounty ? "#8A2BE2" : "#666666",
        weight: isMainCounty ? 3 : 2,
        opacity: isMainCounty ? 0.9 : 0.7,
        fillOpacity: 0,
        fill: false
      });
      
      console.log('Updating layer for county:', layer.feature.properties.tags.name, 'isMain:', isMainCounty);
    }
  });
  
  // Update status message
  if (allCountiesData && allCountiesData.selectedCounties) {
    var selectedCounty = allCountiesData.selectedCounties.find(c => c.relation.id === currentMainCountyId);
    if (selectedCounty) {
      var countyName = selectedCounty.relation.tags.name || 'Unknown County';
      var stateName = stateInfo ? stateInfo.name : 'Unknown State';
      updateStatus(`${allCountiesData.selectedCounties.length} counties loaded`);
      console.log('Status updated for:', countyName, stateName);
    }
  }
  
  // Update label positions after switching main county - this will recreate all labels
  setTimeout(updateCountyLabelPositions, 100);
}

// Handle county boundary toggle
map.on('overlayadd', function(e) {
  if (e.layer === countyBoundaryGroup && !countyBoundaryLoaded) {
    loadCountyAtCenter();
  }
});

map.on('overlayremove', function(e) {
  if (e.layer === countyBoundaryGroup) {
    // Remove all labels when layer is removed
    countyBoundaryGroup.eachLayer(function(layer) {
      if (layer.label) {
        map.removeLayer(layer.label);
      }
    });
    countyBoundaryGroup.clearLayers();
    
    // Clear the labels tracking array
    countyLabels = [];
    
    countyBoundaryLoaded = false;
    updateStatus("Counties hidden");
  }
});

function loadCountyAtCenter() {
  if (!countyBoundaryLoaded) {
    updateStatus("Finding county at map center...");
    
    // Clear previous county data
    countyFeatureLayers = [];
    countyLabels.forEach(function(label) {
      if (map.hasLayer(label)) {
        map.removeLayer(label);
      }
    });
    countyLabels = [];
    
    var center = map.getCenter();
    var lat = center.lat;
    var lng = center.lng;
    
    // Get county at point plus nearby counties for context
    var bbox = getBoundingBox(lat, lng, 0.2); // ~20km radius
    var query = `
      [out:json][timeout:30];
      (
        rel["admin_level"="6"]["boundary"="administrative"](${bbox});
      );
      out geom;
    `;
    
    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      updateStatus("Processing county data...");
      console.log('Counties data received:', data);
      
      if (!data.elements || data.elements.length === 0) {
        updateStatus("No counties found in this area");
        map.removeLayer(countyBoundaryGroup);
        return;
      }
      
      // Find all county relations and calculate distances
      var counties = data.elements
        .filter(el => el.type === 'relation' && el.tags && el.tags.admin_level === '6')
        .map(county => {
          var center = getCountyCenter(county);
          var distance = center ? getDistance(lat, lng, center.lat, center.lng) : Infinity;
          return {
            relation: county,
            center: center,
            distance: distance
          };
        })
        .filter(county => county.center) // Only counties we could calculate center for
        .sort((a, b) => a.distance - b.distance); // Sort by distance
      
      console.log('Found counties:', counties.map(c => ({
        name: c.relation.tags.name,
        distance: Math.round(c.distance * 100) / 100
      })));
      
      // Take the closest 3 counties (main county + 2 adjacent)
      var selectedCounties = counties.slice(0, 3);
      
      if (selectedCounties.length === 0) {
        updateStatus("No counties found at this location");
        map.removeLayer(countyBoundaryGroup);
        return;
      }
      
      var mainCounty = selectedCounties[0].relation;
      console.log('Main county:', mainCounty.tags.name, 'ID:', mainCounty.id);
      
      // Now get the state by querying what contains the main county
      updateStatus("Finding state information...");
      var stateQuery = `
        [out:json][timeout:25];
        (
          rel["admin_level"="4"]["boundary"="administrative"](bbox:${lat-0.1},${lng-0.1},${lat+0.1},${lng+0.1});
          rel["admin_level"="4"]["place"="state"](bbox:${lat-0.1},${lng-0.1},${lat+0.1},${lng+0.1});
        );
        out tags;
      `;
      
      return fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(stateQuery)
      })
      .then(response => response.json())
      .then(stateData => {
        console.log('State data received:', stateData);
        
        var stateInfo = null;
        if (stateData.elements && stateData.elements.length > 0) {
          var stateRel = stateData.elements.find(el => 
            el.type === 'relation' && 
            el.tags && 
            el.tags.admin_level === '4'
          );
          if (stateRel) {
            stateInfo = {
              name: stateRel.tags.name || stateRel.tags['name:en'] || 'Unknown',
              id: stateRel.id
            };
            console.log('Found state:', stateInfo);
          }
        }
        
        // If state lookup failed, try alternative methods
        if (!stateInfo) {
          console.log('State lookup failed, trying alternative methods...');
          var tags = mainCounty.tags;
          var altStateName = tags['is_in:state'] || tags['addr:state'] || tags.state;
          if (altStateName) {
            stateInfo = { name: altStateName, id: null };
            console.log('Found state from county tags:', altStateName);
          }
        }
        
        return {
          allCountiesData: data,
          selectedCounties: selectedCounties,
          mainCounty: mainCounty,
          stateInfo: stateInfo
        };
      });
    })
    .then(result => {
      updateStatus("Building county boundaries...");
      console.log('Final processing with state:', result.stateInfo);
      console.log('Selected counties:', result.selectedCounties.map(c => c.relation.tags.name));
      
      // Store data globally for county switching
      allCountiesData = result;
      currentMainCountyId = result.mainCounty.id;
      stateInfo = result.stateInfo;
      
      var geojsonData = osmToGeoJSON(result.allCountiesData, result.selectedCounties.map(c => c.relation.id));
      
      if (geojsonData.features.length === 0) {
        updateStatus("Could not build county geometry");
        map.removeLayer(countyBoundaryGroup);
        return;
      }
      
      console.log('Creating GeoJSON layer with', geojsonData.features.length, 'features');
      
      var layer = L.geoJSON(geojsonData, {
        style: function(feature) {
          var isMainCounty = feature.properties.id === currentMainCountyId;
          // Always use outline style
          return {
            color: isMainCounty ? "#8A2BE2" : "#666666",
            weight: isMainCounty ? 3 : 2,
            opacity: isMainCounty ? 0.9 : 0.7,
            fillOpacity: 0,
            fill: false
          };
        },
        onEachFeature: function(feature, layer) {
          // Add county name labels
          if (feature.properties && feature.properties.tags) {
            var tags = feature.properties.tags;
            var countyName = tags.name || 'Unknown County';
            
            console.log('Creating labelTemplate for county:', countyName, 'ID:', feature.properties.id);
            
            // Store label reference but don't add to map yet
            // Labels will be managed by updateCountyLabelPositions
            layer.labelTemplate = {
              countyName: countyName,
              countyId: feature.properties.id
            };
            
            // Store reference to this feature layer for easy access during repositioning
            countyFeatureLayers.push(layer);
            
            console.log('labelTemplate created and layer stored:', layer.labelTemplate);
          } else {
            console.log('No feature properties or tags found for layer');
          }
          
          // Add click handler to switch main county
          layer.on('click', function(e) {
            console.log('County clicked:', feature.properties.tags.name, 'ID:', feature.properties.id);
            console.log('Current main county ID:', currentMainCountyId);
            e.originalEvent.stopPropagation();
            switchMainCounty(feature.properties.id);
          });
          
          // Add hover effect for better UX
          layer.on('mouseover', function(e) {
            if (feature.properties.id !== currentMainCountyId) {
              layer.setStyle({
                color: "#8A2BE2",
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0,
                fill: false
              });
              map.getContainer().style.cursor = 'pointer';
            }
          });
          
          layer.on('mouseout', function(e) {
            if (feature.properties.id !== currentMainCountyId) {
              layer.setStyle({
                color: "#666666",
                weight: 2,
                opacity: 0.7,
                fillOpacity: 0,
                fill: false
              });
            }
            map.getContainer().style.cursor = '';
          });
        }
      });
      
      console.log('GeoJSON layer created, adding to countyBoundaryGroup');
      countyBoundaryGroup.addLayer(layer);
      console.log('Layer added. Group now has layers:', countyBoundaryGroup.getLayers().length);
      countyBoundaryLoaded = true;
      
      // Show initial main county and state in status
      updateStatus(`${result.selectedCounties.length} counties loaded`);
      
      // Initialize label positions after counties are loaded
      console.log('Counties loaded, calling updateCountyLabelPositions in 500ms to ensure everything is ready...');
      setTimeout(function() {
        console.log('Timer fired, calling updateCountyLabelPositions now');
        updateCountyLabelPositions();
      }, 500);
    })
    .catch(err => {
      console.error('Error loading county boundary:', err);
      var errorMsg = "Error loading county boundary: ";
      
      if (err.message.includes('400')) {
        errorMsg += "Invalid query. Try moving to a different location.";
      } else if (err.message.includes('429')) {
        errorMsg += "Too many requests. Please wait a moment and try again.";
      } else if (err.message.includes('504') || err.message.includes('timeout')) {
        errorMsg += "Server timeout. Try again later.";
      } else if (err.message.includes('Failed to fetch')) {
        errorMsg += "Network error. Check your internet connection.";
      } else {
        errorMsg += err.message;
      }
      
      updateStatus(errorMsg);
      map.removeLayer(countyBoundaryGroup);
    });
  }
}

// Auto-locate user on page load
function autoLocate() {
  if (navigator.geolocation) {
    updateStatus("Getting your location...");
    navigator.geolocation.getCurrentPosition(function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;
      
      // Store user location for label positioning
      userLocation = { lat: lat, lng: lng };
      
      map.setView([lat, lng], 12);
      
      // Add location marker
      if (locationMarker) {
        map.removeLayer(locationMarker);
      }
      locationMarker = L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: "#ff0000",
        color: "#ffffff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
      }).addTo(map).bindPopup("Your location");
      
      updateStatus("Location found! Loading nearby counties...");
      
      // Auto-load counties after location is found
      setTimeout(() => {
        if (!countyBoundaryLoaded) {
          loadCountyAtCenter();
        }
      }, 1000);
      
    }, function(error) {
      updateStatus("Location access denied. Use layer control to toggle county boundary.");
    });
  } else {
    updateStatus("Geolocation not supported. Use layer control to toggle county boundary.");
  }
}

// Helper function to create bounding box around a point
function getBoundingBox(lat, lng, radiusDegrees) {
  return `${lat - radiusDegrees},${lng - radiusDegrees},${lat + radiusDegrees},${lng + radiusDegrees}`;
}

// Helper function to get approximate center of a county
function getCountyCenter(county) {
  if (!county.members) return null;
  
  var allCoords = [];
  county.members.forEach(function(member) {
    if (member.type === 'way' && member.geometry) {
      member.geometry.forEach(function(coord) {
        allCoords.push([coord.lat, coord.lon]);
      });
    }
  });
  
  if (allCoords.length === 0) return null;
  
  var sumLat = allCoords.reduce((sum, coord) => sum + coord[0], 0);
  var sumLng = allCoords.reduce((sum, coord) => sum + coord[1], 0);
  
  return {
    lat: sumLat / allCoords.length,
    lng: sumLng / allCoords.length
  };
}

// Helper function to calculate distance between two points
function getDistance(lat1, lng1, lat2, lng2) {
  var R = 6371; // Earth's radius in km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLng/2) * Math.sin(dLng/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Convert OSM to GeoJSON (multiple counties)
function osmToGeoJSON(osmData, selectedCountyIds) {
  var features = [];
  
  console.log('Processing OSM elements:', osmData.elements.length);
  console.log('Selected county IDs:', selectedCountyIds);
  
  osmData.elements.forEach(function(relation) {
    if (relation.type === 'relation' && 
        relation.tags && 
        relation.tags.admin_level === '6' && 
        selectedCountyIds.includes(relation.id) &&
        relation.members) {
      
      console.log('Processing county:', relation.tags.name);
      
      try {
        var outerWays = [];
        
        relation.members.forEach(function(member) {
          if (member.type === 'way' && member.role === 'outer' && member.geometry) {
            var coordinates = member.geometry.map(function(coord) {
              return [coord.lon, coord.lat];
            });
            if (coordinates.length >= 2) {
              outerWays.push(coordinates);
            }
          }
        });
        
        if (outerWays.length > 0) {
          var rings = assembleRings(outerWays);
          
          if (rings.length > 0) {
            var geometry = {
              type: "Polygon",
              coordinates: rings
            };
            
            features.push({
              type: "Feature",
              properties: {
                id: relation.id,
                tags: relation.tags || {}
              },
              geometry: geometry
            });
            console.log('Added county feature:', relation.tags.name);
          }
        }
      } catch (error) {
        console.warn('Error processing county relation:', relation.id, error);
      }
    }
  });
  
  console.log('Final features:', features.length);
  
  return {
    type: "FeatureCollection",
    features: features
  };
}

// Assemble coordinate rings
function assembleRings(waySegments) {
  if (!waySegments || waySegments.length === 0) return [];
  
  var rings = [];
  var unusedSegments = waySegments.slice();
  
  while (unusedSegments.length > 0) {
    var currentRing = unusedSegments.shift();
    var ringComplete = false;
    
    while (!ringComplete && unusedSegments.length > 0) {
      var segmentAdded = false;
      
      for (var i = 0; i < unusedSegments.length; i++) {
        var segment = unusedSegments[i];
        
        if (coordinatesEqual(currentRing[currentRing.length - 1], segment[0])) {
          currentRing = currentRing.concat(segment.slice(1));
          unusedSegments.splice(i, 1);
          segmentAdded = true;
          break;
        } else if (coordinatesEqual(currentRing[currentRing.length - 1], segment[segment.length - 1])) {
          var reversedSegment = segment.slice(0, -1).reverse();
          currentRing = currentRing.concat(reversedSegment);
          unusedSegments.splice(i, 1);
          segmentAdded = true;
          break;
        }
      }
      
      if (!segmentAdded) break;
      
      if (currentRing.length >= 4 && 
          coordinatesEqual(currentRing[0], currentRing[currentRing.length - 1])) {
        ringComplete = true;
      }
    }
    
    if (!ringComplete && currentRing.length >= 4) {
      currentRing.push([currentRing[0][0], currentRing[0][1]]);
      ringComplete = true;
    }
    
    if (ringComplete && currentRing.length >= 4) {
      rings.push(currentRing);
    }
  }
  
  return rings;
}

function coordinatesEqual(coord1, coord2) {
  if (!coord1 || !coord2) return false;
  return Math.abs(coord1[0] - coord2[0]) < 0.0000001 && 
         Math.abs(coord1[1] - coord2[1]) < 0.0000001;
}

// Handle window resize for responsive label sizing
window.addEventListener('resize', function() {
  // Debounce resize events
  clearTimeout(window.resizeTimeout);
  window.resizeTimeout = setTimeout(function() {
    updateLabels();
  }, 250);
});

// Start auto-location
window.addEventListener('load', function() {
  setTimeout(autoLocate, 500);
});

// Helper: compute minimum distance from a point to polygon boundary (in meters)
function minDistanceToPolygonBoundary(latlng, layer) {
  var minDist = Infinity;
  var coords = null;
  
  if (layer.feature && layer.feature.geometry) {
    var geom = layer.feature.geometry;
    if (geom.type === 'Polygon') {
      coords = geom.coordinates[0];
    } else if (geom.type === 'MultiPolygon') {
      coords = geom.coordinates[0][0];
    }
    if (coords) {
      // Check distance to each edge of the polygon, not just vertices
      for (var i = 0; i < coords.length - 1; i++) {
        var p1 = L.latLng(coords[i][1], coords[i][0]);
        var p2 = L.latLng(coords[i+1][1], coords[i+1][0]);
        var dist = distanceToLineSegment(latlng, p1, p2);
        if (dist < minDist) minDist = dist;
      }
    }
  } else if (layer.getLatLngs) {
    var latlngs = layer.getLatLngs();
    if (latlngs && latlngs.length > 0) {
      var arr = Array.isArray(latlngs[0][0]) ? latlngs[0][0] : latlngs[0];
      // Check distance to each edge of the polygon, not just vertices
      for (var i = 0; i < arr.length - 1; i++) {
        var p1 = arr[i], p2 = arr[i+1];
        var dist = distanceToLineSegment(latlng, p1, p2);
        if (dist < minDist) minDist = dist;
      }
    }
  }
  return minDist;
}

// Helper: calculate distance from point to line segment in meters
function distanceToLineSegment(point, lineStart, lineEnd) {
  var A = point.lat - lineStart.lat;
  var B = point.lng - lineStart.lng;
  var C = lineEnd.lat - lineStart.lat;
  var D = lineEnd.lng - lineStart.lng;

  var dot = A * C + B * D;
  var lenSq = C * C + D * D;
  var param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  var xx, yy;
  if (param < 0) {
    xx = lineStart.lat;
    yy = lineStart.lng;
  } else if (param > 1) {
    xx = lineEnd.lat;
    yy = lineEnd.lng;
  } else {
    xx = lineStart.lat + param * C;
    yy = lineStart.lng + param * D;
  }

  return map.distance(point, L.latLng(xx, yy));
}
