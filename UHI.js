// Define Java Island boundary
var java = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'Indonesia'))
  .filter(ee.Filter.inList('ADM1_NAME', ['Jawa Barat', 'Jawa Tengah', 'Jawa Timur', 
                                          'Banten', 'Jakarta Raya', 'Yogyakarta']));

var javaBounds = java.geometry();

// Center map on Java
Map.centerObject(javaBounds, 8);
Map.setOptions('HYBRID');

// Time period for analysis
var startDate = '2024-06-01'; // Dry season
var endDate = '2024-09-30';

// === 1. LAND SURFACE TEMPERATURE (LST) ===
// Using Landsat 8/9 thermal bands
var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(javaBounds)
  .filterDate(startDate, endDate)
  .filter(ee.Filter.lt('CLOUD_COVER', 20));

// Function to calculate LST from Landsat
function calculateLST(image) {
  // Get thermal band (ST_B10) and convert to Celsius
  var lst = image.select('ST_B10')
    .multiply(0.00341802).add(149.0)  // Scale factor
    .subtract(273.15)  // Kelvin to Celsius
    .rename('LST');
  
  return image.addBands(lst);
}

var lstCollection = landsat.map(calculateLST);
var lstMean = lstCollection.select('LST').mean().clip(javaBounds);

// Visualize LST
var lstVis = {
  min: 20,
  max: 45,
  palette: ['blue', 'cyan', 'yellow', 'orange', 'red']
};
Map.addLayer(lstMean, lstVis, 'Land Surface Temperature (°C)', true);

// === 2. URBAN AREA CLASSIFICATION ===
// Using NDVI and NDBI to identify urban areas
var median = landsat.median();

// Calculate NDVI (vegetation index)
var ndvi = median.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');

// Calculate NDBI (built-up index)
var ndbi = median.normalizedDifference(['SR_B6', 'SR_B5']).rename('NDBI');

// Urban mask: high NDBI and low NDVI
var urbanMask = ndbi.gt(0.1).and(ndvi.lt(0.2)).selfMask();
Map.addLayer(urbanMask, {palette: 'red'}, 'Urban Areas', false);

// === 3. URBAN HEAT ISLAND INTENSITY ===
// Compare urban vs rural temperatures

// Rural areas: high NDVI, low NDBI
var ruralMask = ndvi.gt(0.3).and(ndbi.lt(-0.1));

// Calculate mean LST for urban areas
var urbanLST = lstMean.updateMask(urbanMask);
var urbanTemp = urbanLST.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: javaBounds,
  scale: 100,
  maxPixels: 1e13
});

// Calculate mean LST for rural areas
var ruralLST = lstMean.updateMask(ruralMask);
var ruralTemp = ruralLST.reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: javaBounds,
  scale: 100,
  maxPixels: 1e13
});

// UHI Intensity = Urban Temp - Rural Temp
var uhiIntensity = lstMean.where(urbanMask.not(), 0)
  .subtract(ee.Number(ruralTemp.get('LST')))
  .updateMask(urbanMask)
  .rename('UHI_Intensity');

Map.addLayer(uhiIntensity, {
  min: 0,
  max: 10,
  palette: ['white', 'yellow', 'orange', 'red', 'darkred']
}, 'UHI Intensity (°C)', true);

// === 4. MAJOR CITIES ANALYSIS ===
var cities = [
  {name: 'Jakarta', coords: [106.8456, -6.2088]},
  {name: 'Surabaya', coords: [112.7521, -7.2575]},
  {name: 'Bandung', coords: [107.6191, -6.9175]},
  {name: 'Semarang', coords: [110.4203, -6.9932]},
  {name: 'Yogyakarta', coords: [110.3695, -7.7956]}
];

// Create 10km buffer around each city and calculate statistics
cities.forEach(function(city) {
  var point = ee.Geometry.Point(city.coords);
  var buffer = point.buffer(10000); // 10km radius
  
  var cityLST = lstMean.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: buffer,
    scale: 100,
    maxPixels: 1e13
  });
  
  Map.addLayer(buffer, {color: 'yellow'}, city.name + ' Buffer', false);
  print(city.name + ' Average LST (°C):', cityLST.get('LST'));
});

// === 5. STATISTICS PANEL ===
var statsPanel = ui.Panel({
  style: {
    position: 'top-right',
    padding: '8px 15px',
    backgroundColor: 'white',
    width: '300px'
  }
});

var title = ui.Label({
  value: 'URBAN HEAT ISLAND STATISTICS',
  style: {
    fontWeight: 'bold',
    fontSize: '16px',
    margin: '0 0 10px 0',
    textAlign: 'center'
  }
});

statsPanel.add(title);

// Add statistics
urbanTemp.get('LST').evaluate(function(uTemp) {
  ruralTemp.get('LST').evaluate(function(rTemp) {
    var uhi = (uTemp - rTemp).toFixed(2);
    
    statsPanel.add(ui.Label({
      value: 'Analysis Period:',
      style: {fontWeight: 'bold', margin: '10px 0 5px 0'}
    }));
    statsPanel.add(ui.Label(startDate + ' to ' + endDate));
    
    statsPanel.add(ui.Label({
      value: '━━━━━━━━━━━━━━━',
      style: {margin: '8px 0', color: 'gray'}
    }));
    
    statsPanel.add(ui.Label({
      value: 'Average Urban LST:',
      style: {fontWeight: 'bold'}
    }));
    statsPanel.add(ui.Label({
      value: uTemp.toFixed(2) + ' °C',
      style: {color: 'red', fontSize: '18px', margin: '0 0 10px 0'}
    }));
    
    statsPanel.add(ui.Label({
      value: 'Average Rural LST:',
      style: {fontWeight: 'bold'}
    }));
    statsPanel.add(ui.Label({
      value: rTemp.toFixed(2) + ' °C',
      style: {color: 'green', fontSize: '18px', margin: '0 0 10px 0'}
    }));
    
    statsPanel.add(ui.Label({
      value: '━━━━━━━━━━━━━━━',
      style: {margin: '8px 0', color: 'gray'}
    }));
    
    statsPanel.add(ui.Label({
      value: 'UHI Intensity:',
      style: {fontWeight: 'bold'}
    }));
    statsPanel.add(ui.Label({
      value: uhi + ' °C',
      style: {color: 'darkred', fontSize: '20px', fontWeight: 'bold'}
    }));
    
    statsPanel.add(ui.Label({
      value: 'Urban areas are ' + uhi + '°C warmer than rural areas',
      style: {fontSize: '12px', margin: '5px 0', color: 'gray', whiteSpace: 'pre-wrap'}
    }));
  });
});

Map.add(statsPanel);

// === 6. TEMPERATURE DISTRIBUTION CHART ===
var chart = ui.Chart.image.histogram({
  image: lstMean,
  region: javaBounds,
  scale: 1000,
  maxPixels: 1e13
})
.setOptions({
  title: 'Temperature Distribution Across Java Island',
  vAxis: {title: 'Frequency'},
  hAxis: {title: 'Temperature (°C)'},
  colors: ['red']
});

print(chart);

// === 7. LEGEND ===
var legend = ui.Panel({
  style: {
    position: 'bottom-left',
    padding: '8px 15px',
    backgroundColor: 'white'
  }
});

legend.add(ui.Label({
  value: 'LEGEND',
  style: {fontWeight: 'bold', fontSize: '14px', margin: '0 0 8px 0'}
}));

// Create color bar for LST
var makeColorBar = function(palette, min, max, title) {
  var colorBar = ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: {
      bbox: [0, 0, 1, 0.1],
      dimensions: '200x20',
      format: 'png',
      min: 0,
      max: 1,
      palette: palette
    },
    style: {stretch: 'horizontal', margin: '8px 0px'}
  });
  
  var labels = ui.Panel({
    widgets: [
      ui.Label(min + '°C', {margin: '4px 8px', fontSize: '12px'}),
      ui.Label(max + '°C', {margin: '4px 8px', textAlign: 'right', stretch: 'horizontal', fontSize: '12px'})
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  });
  
  var panel = ui.Panel({
    widgets: [
      ui.Label({value: title, style: {fontWeight: 'bold', margin: '4px 0'}}),
      colorBar,
      labels
    ]
  });
  
  return panel;
};

legend.add(makeColorBar(lstVis.palette, lstVis.min, lstVis.max, 'Land Surface Temp'));

Map.add(legend);

// Show Java boundary
Map.addLayer(ee.Image().paint(java, 0, 2), {palette: 'black'}, 'Java Island Boundary', true);

// Print image count
print('Landsat images used:', landsat.size());
