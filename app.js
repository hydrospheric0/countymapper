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
var countyLabels = []; // Track all county labels for repositioning

function updateStatus(message) {
  statusDiv.textContent = message;
}

// Update all county label positions when map moves
function updateCountyLabelPositions() {
  if (!countyBoundaryGroup) {
    console.log('updateCountyLabelPositions: No county group');
    return;
  }
  
  console.log('updateCountyLabelPositions: Recalculating all label positions');
  
  // Remove all existing labels from map
  countyLabels.forEach(function(label) {
    if (map.hasLayer(label)) {
      map.removeLayer(label);
    }
  });
  
  // Clear the labels array
  countyLabels = [];
  
  // Recreate labels with new positions
  countyBoundaryGroup.eachLayer(function(layer) {
    if (layer.feature && layer.feature.properties && layer.feature.properties.tags) {
      var countyName = layer.feature.properties.tags.name || 'Unknown County';
      
      // Check if county is currently visible on the map
      var bounds = map.getBounds();
      var countyBounds = layer.getBounds();
      
      // Only create label if county is visible or partially visible
      if (bounds.intersects(countyBounds)) {
        console.log('Creating label for visible county:', countyName);
        
        // Calculate new position
        var newPosition = getBestLabelPosition(layer, layer.feature.properties.id);
        
        var isMainCounty = layer.feature.properties.id === currentMainCountyId;
        var labelStyle = isMainCounty ? 
          'background: rgba(138, 43, 226, 0.95); color: white; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: bold; text-align: center; border: 2px solid #8A2BE2; box-shadow: 0 3px 6px rgba(0,0,0,0.4); cursor: pointer;' :
          'background: rgba(255,255,255,0.95); color: #333; padding: 3px 8px; border-radius: 5px; font-size: 12px; font-weight: bold; text-align: center; border: 1px solid #666; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: pointer;';
        
        var label = L.marker(newPosition, {
          icon: L.divIcon({
            className: 'county-label',
            html: `<div style="${labelStyle}">${countyName}</div>`,
            iconSize: [130, 26],
            iconAnchor: [65, 13]
          })
        });
        
        // Make labels clickable for county switching
        label.on('click', function(e) {
          console.log('Label clicked for county:', countyName, 'ID:', layer.feature.properties.id);
          e.originalEvent.stopPropagation();
          switchMainCounty(layer.feature.properties.id);
        });
        
        // Add to map and tracking
        map.addLayer(label);
        countyLabels.push(label);
        
        // Store reference on the layer for easy access
        layer.currentLabel = label;
      } else {
        console.log('County', countyName, 'is out of view, not creating label');
      }
    }
  });
  
  console.log('Created', countyLabels.length, 'labels');
}

// Add map event listeners for label repositioning
map.on('moveend', function() {
  console.log('moveend event triggered');
  updateCountyLabelPositions();
});

map.on('zoomend', function() {
  console.log('zoomend event triggered');
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

// Find the best position for county label with "magnetic" attraction to user location
function getBestLabelPosition(layer, countyId) {
  if (!userLocation) {
    // Fallback to center if no user location
    return layer.getBounds().getCenter();
  }
  
  var isMainCounty = countyId === currentMainCountyId;
  var userLatLng = L.latLng(userLocation.lat, userLocation.lng);
  var bounds = layer.getBounds();
  var center = bounds.getCenter();
  
  // For main county, place label very close to user location
  if (isMainCounty) {
    // Check if user location is inside the county bounds
    if (bounds.contains(userLatLng)) {
      // User is inside - place label close but offset to avoid marker overlap
      var offsetDistance = 0.01; // ~1km
      var offsetLat = userLocation.lat + offsetDistance;
      var offsetLng = userLocation.lng + offsetDistance * 0.7;
      var offsetPosition = L.latLng(offsetLat, offsetLng);
      
      // If offset is still in bounds, use it, otherwise try other directions
      if (bounds.contains(offsetPosition)) {
        return offsetPosition;
      } else {
        // Try different offsets
        var alternatives = [
          L.latLng(userLocation.lat - offsetDistance, userLocation.lng + offsetDistance * 0.7),  // south-east
          L.latLng(userLocation.lat + offsetDistance, userLocation.lng - offsetDistance * 0.7),  // north-west
          L.latLng(userLocation.lat - offsetDistance, userLocation.lng - offsetDistance * 0.7),  // south-west
          L.latLng(userLocation.lat, userLocation.lng + offsetDistance * 1.5),                   // east
          L.latLng(userLocation.lat, userLocation.lng - offsetDistance * 1.5),                   // west
          L.latLng(userLocation.lat + offsetDistance * 1.5, userLocation.lng),                   // north
          L.latLng(userLocation.lat - offsetDistance * 1.5, userLocation.lng)                    // south
        ];
        
        for (var i = 0; i < alternatives.length; i++) {
          if (bounds.contains(alternatives[i])) {
            return alternatives[i];
          }
        }
        
        // If all offsets are outside bounds, use a small offset from user location
        return L.latLng(userLocation.lat + offsetDistance * 0.3, userLocation.lng + offsetDistance * 0.3);
      }
    }
  }
  
  // For adjacent counties, place label inside county bounds but close to border near user
  try {
    var geometry = layer.feature.geometry;
    if (geometry && geometry.coordinates) {
      var closestPoint = null;
      var minDistance = Infinity;
      
      // Sample points along the county boundary to find closest to user
      var coords = geometry.coordinates[0]; // First ring
      var step = Math.max(1, Math.floor(coords.length / 50)); // Dense sampling
      
      for (var i = 0; i < coords.length; i += step) {
        var point = L.latLng(coords[i][1], coords[i][0]);
        var distance = userLatLng.distanceTo(point);
        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = point;
        }
      }
      
      if (closestPoint) {
        // Move inward from the closest boundary point toward county center
        // This ensures the label stays inside the county
        var inwardDistance = 0.020; // ~2km inward from boundary
        var directionToCenter = {
          lat: center.lat - closestPoint.lat,
          lng: center.lng - closestPoint.lng
        };
        
        // Normalize direction
        var magnitude = Math.sqrt(directionToCenter.lat * directionToCenter.lat + directionToCenter.lng * directionToCenter.lng);
        if (magnitude > 0) {
          directionToCenter.lat /= magnitude;
          directionToCenter.lng /= magnitude;
          
          // Move inward from closest point
          var inwardLat = closestPoint.lat + directionToCenter.lat * inwardDistance;
          var inwardLng = closestPoint.lng + directionToCenter.lng * inwardDistance;
          var inwardPosition = L.latLng(inwardLat, inwardLng);
          
          // If inward position is still in bounds, use it
          if (bounds.contains(inwardPosition)) {
            return inwardPosition;
          }
        }
        
        // Fallback: move from boundary toward center by a larger amount
        var safeLat = closestPoint.lat + (center.lat - closestPoint.lat) * 0.25;
        var safeLng = closestPoint.lng + (center.lng - closestPoint.lng) * 0.25;
        var safePosition = L.latLng(safeLat, safeLng);
        
        if (bounds.contains(safePosition)) {
          return safePosition;
        }
      }
    }
  } catch (error) {
    console.warn('Error calculating boundary-aware label position:', error);
  }
  
  // Final fallback - move center toward user location
  var centerToUserLat = center.lat + (userLocation.lat - center.lat) * 0.4;
  var centerToUserLng = center.lng + (userLocation.lng - center.lng) * 0.4;
  return L.latLng(centerToUserLat, centerToUserLng);
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
            
            // Calculate label position inside county bounds but close to border near user
            var labelPosition = getBestLabelPosition(layer, feature.properties.id);
            
            var isMainCounty = feature.properties.id === currentMainCountyId;
            var labelStyle = isMainCounty ? 
              'background: rgba(138, 43, 226, 0.95); color: white; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: bold; text-align: center; border: 2px solid #8A2BE2; box-shadow: 0 3px 6px rgba(0,0,0,0.4); cursor: pointer;' :
              'background: rgba(255,255,255,0.95); color: #333; padding: 3px 8px; border-radius: 5px; font-size: 12px; font-weight: bold; text-align: center; border: 1px solid #666; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: pointer;';
            
            var label = L.marker(labelPosition, {
              icon: L.divIcon({
                className: 'county-label',
                html: `<div style="${labelStyle}">${countyName}</div>`,
                iconSize: [130, 26],
                iconAnchor: [65, 13]
              })
            });
            
            // Don't add to map initially - will be managed by updateCountyLabelPositions
            
            // Make labels clickable for county switching
            label.on('click', function(e) {
              console.log('Label clicked for county:', countyName, 'ID:', feature.properties.id);
              e.originalEvent.stopPropagation();
              switchMainCounty(feature.properties.id);
            });
            
            // Store label reference (will be managed by updateCountyLabelPositions)
            layer.initialLabel = label;
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
      
      countyBoundaryGroup.addLayer(layer);
      countyBoundaryLoaded = true;
      
      // Show initial main county and state in status
      updateStatus(`${result.selectedCounties.length} counties loaded`);
      
      // Initialize label positions after counties are loaded
      setTimeout(updateCountyLabelPositions, 100);
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
      
      updateStatus("Location found! Toggle county boundary in layer control.");
      
      // Auto-enable county boundary
      setTimeout(() => {
        if (!map.hasLayer(countyBoundaryGroup)) {
          map.addLayer(countyBoundaryGroup);
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

// Start auto-location
window.addEventListener('load', function() {
  setTimeout(autoLocate, 500);
});
