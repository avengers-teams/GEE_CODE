
var roi = ee.FeatureCollection("projects/my-project-1684574041697/assets/region");
Map.addLayer(roi, {color: 'grey'}, 'studyArea');
Map.centerObject(roi);

var startYear = 2000;
var endYear = 2024;

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}


var products = [
  { name: 'TerraDay',   collection: 'MODIS/061/MOD11A1', band: 'LST_Day_1km' },
  { name: 'TerraNight', collection: 'MODIS/061/MOD11A1', band: 'LST_Night_1km' },
  { name: 'AquaDay',    collection: 'MODIS/061/MYD11A1', band: 'LST_Day_1km' },
  { name: 'AquaNight',  collection: 'MODIS/061/MYD11A1', band: 'LST_Night_1km' }
];


for (var year = startYear; year <= endYear; year++) {
  for (var month = 1; month <= 12; month++) {
    var days = daysInMonth(year, month);
    for (var day = 1; day <= days; day++) {
      var currentDate = ee.Date.fromYMD(year, month, day);
      var nextDate = currentDate.advance(1, 'day');
      
      products.forEach(function(prod) {
        var imgCol = ee.ImageCollection(prod.collection)
                      .filterDate(currentDate, nextDate)
                      .select(prod.band);

        var img = ee.Image(imgCol.first());
        img = img.multiply(0.02).clip(roi).reproject({
          crs: 'EPSG:4326', 
          scale: 1000        
        });
        var fileName = prod.name + '_' + year + '_' + month + '_' + day;
        
        Export.image.toDrive({
          image: img,
          description: fileName,
          folder: 'MODIS_LST_daily',
          region: roi,
          scale: 1000,
          maxPixels: 1e8
        });
      });
      
    }
  }
}
