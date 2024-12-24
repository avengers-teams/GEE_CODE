// 定义研究点坐标
var cor = [108.94736940174342,34.25457667935074];
var point = ee.Geometry.Point(cor);

// 加载FAO GAUL数据集并筛选研究区域
var feature = ee.FeatureCollection("FAO/GAUL/2015/level2");
var roi = feature.filterBounds(point);
Map.centerObject(roi);
Map.addLayer(roi);

// 定义时间范围
var time_start = '2020', time_end = '2024';

// 加载MODIS NDVI数据集
var ndvi = ee.ImageCollection("MODIS/061/MOD13A2")
  .select(['NDVI'])
  .filterDate(time_start, time_end);

// 计算VCI
var ndvi_min = ndvi.min().multiply(0.0001);
var ndvi_max = ndvi.max().multiply(0.0001);

var vci = ndvi.map(function (img) {
  var band = img.multiply(0.0001);
  var index = band.expression('((ndvi - min)/(max - min))*100.0', {
    'ndvi': band,
    'min': ndvi_min,
    'max': ndvi_max
  }).rename('vci');
  return index.copyProperties(img, ['system:time_start', 'system:time_end']);
});

// 计算VCI中值
var vci_median = vci.median();
Map.addLayer(vci_median.clip(roi), [], 'vci_median', false);

// 打印VCI直方图
print(
  ui.Chart.image.histogram(vci_median, roi, 1000)
);

// VCI分类
var cons = ee.Image.constant(0);

var extreme = cons.where(vci_median.gte(0).and(vci_median.lt(10)), 1);
var severe = extreme.where(vci_median.gte(10).and(vci_median.lt(20)), 2);
var moderate = severe.where(vci_median.gte(20).and(vci_median.lt(30)), 3);
var light = moderate.where(vci_median.gte(30).gte(vci_median.lt(40)), 4);
var no1 = light.where(vci_median.gte(40).and(vci_median.lt(60)), 5);
var no2 = no1.where(vci_median.gte(60).and(vci_median.lt(80)), 6);
var no3 = no2.where(vci_median.gte(80), 7);

Map.addLayer(moderate.clip(roi), {min: 1, max: 7}, 'drought_map', false);

// VCI时间序列分类
var time_start = '2001', time_end = '2024';
var ndvi2 = ee.ImageCollection("MODIS/061/MOD13A2")
  .select(['NDVI'])
  .filterDate(time_start, time_end);

var ndvi_min2 = ndvi2.min().multiply(0.0001);
var ndvi_max2 = ndvi2.max().multiply(0.0001);

var vci2 = ndvi2.map(function (img) {
  var band = img.multiply(0.0001);
  var index = band.expression('((ndvi - min)/(max - min))*100.0', {
    'ndvi': band,
    'min': ndvi_min2,
    'max': ndvi_max2
  }).rename('vci');
  return index.copyProperties(img, ['system:time_start', 'system:time_end']);
});

// 修正：vci_class 应使用 vci2 而不是 vci_median
var vci_class = vci2.map(function (img) {
  var vci_value = img.select('vci');
  return img.expression(
    'extreme + severe + moderate + light + no1 + no2 + no3',
    {
      'extreme': vci_value.gte(0).and(vci_value.lt(10)).multiply(1),
      'severe': vci_value.gte(10).and(vci_value.lt(20)).multiply(2),
      'moderate': vci_value.gte(20).and(vci_value.lt(30)).multiply(3),
      'light': vci_value.gte(30).and(vci_value.lt(40)).multiply(4),
      'no1': vci_value.gte(40).and(vci_value.lt(60)).multiply(5),
      'no2': vci_value.gte(60).and(vci_value.lt(80)).multiply(6),
      'no3': vci_value.gte(80).multiply(7)
    }
  ).rename('class');
});

var vci_map = vci_class.mode();

Map.addLayer(vci_map.clip(roi), {
  palette: ['black', 'brown', 'red', 'orange', 'yellow', 'lightgreen', 'darkgreen'],
  min: 1,
  max: 7
}, 'vci_mode', false);

// 导出VCI分类图
Export.image.toDrive({
  image: vci_map.clip(roi),
  description: 'vci_map',
  region: roi,
  maxPixels: 1e13,
  crs: 'EPSG:4326',
  folder: 'drought',
  scale: 1000
});

// 计算干旱面积
var drought_area = (ee.Image.pixelArea().divide(1e6)).addBands(vci_map);  // 添加区域面积图层

// 打印按类别分组的面积统计图表
print(
  ui.Chart.image.byClass(drought_area, 'class',  // 使用正确的字段 'class' 来进行分组
    roi, ee.Reducer.sum(), 1000)  // 按类别计算总面积
    .setChartType('BarChart')  // 可以选择输出为条形图
);
