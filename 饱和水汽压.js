var dataset = ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR")
                .filterDate('2000-01-01', '2024-12-31');

var china = ee.Geometry.Polygon([
  [[73.5, 53.5], [135.0, 53.5], [135.0, 18.0], [73.5, 18.0]]
]);


var years = ee.List.sequence(2000, 2024);

years.getInfo().forEach(function(year) {
  ee.List.sequence(1, 12).getInfo().forEach(function(month) {
    var monthlyData = dataset
      .filter(ee.Filter.calendarRange(year, year, 'year'))
      .filter(ee.Filter.calendarRange(month, month, 'month'))
      .mean();
    
    var temperature = monthlyData.select('temperature_2m').subtract(273.15);
    var dewPointTemperature = monthlyData.select('dewpoint_temperature_2m').subtract(273.15);

    var e_s = temperature.expression(
      '6.11 * exp(17.27 * T_C / (237.3 + T_C))', {
        'T_C': temperature
      });

    var e_a = dewPointTemperature.expression(
      '6.11 * exp(17.27 * T_dpC / (237.3 + T_dpC))', {
        'T_dpC': dewPointTemperature
      });

    var VPD = e_s.subtract(e_a).divide(10).rename('VPD').clip(china);
    
    var monthStr = month < 10 ? '0' + month : '' + month;
    
    Export.image.toDrive({
      image: VPD,
      description: 'VPD_' + year + '_' + monthStr,
      scale: 11132,
      region: china,
      crs: 'EPSG:4326',
      maxPixels: 1e13
    });
  });
});
