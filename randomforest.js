var region = ee.FeatureCollection("projects/ee-yzr5977/assets/hefei");
var training = ee.FeatureCollection("projects/ee-yzr5977/assets/2018test");

// 首先检查训练数据的属性
print('Training Data First Feature:', training.first());
print('Training Data Properties:', training.first().propertyNames());
print('Number of Training Points:', training.size());

// 云掩膜处理
function maskL8sr(image) {
  var qa = image.select('QA_PIXEL');
  var cloudShadowBitMask = 1 << 4;
  var cloudsBitMask = 1 << 3;
  
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
               .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  
  return image.updateMask(mask);
}

var startDate = ee.Date.fromYMD(2018, 6, 1);
var endDate = ee.Date.fromYMD(2018, 10, 30);

// 加载该年份的Landsat 8数据
var landsat8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                .filterBounds(region)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUD_COVER', 10))
                .map(maskL8sr);

// 定义要使用的波段名称
var bands = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'];

// 选择波段并计算中值合成
var composite = landsat8.select(bands).median().clip(region);

// 显示原始影像
Map.centerObject(region, 10);
Map.addLayer(composite, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 7000, max: 30000}, 'Landsat RGB');

// 获取训练数据中实际的类别属性名称
var propertyNames = training.first().propertyNames();
print('Available Properties in Training Data:', propertyNames);

// 在控制台查看后，将正确的属性名称替换到下面的代码中
var classProperty = 'CLASS_ID'; // 替换为实际的属性名称

// 确保类别属性为数值类型
var training = training.map(function(feature) {
  return feature.set(classProperty, ee.Number.parse(feature.get(classProperty)));
});

// 提取训练数据
var trainingData = composite.sampleRegions({
  collection: training,
  properties: [classProperty], // 使用正确的属性名称
  scale: 30
});

// 构建随机森林分类器
var classifier = ee.Classifier.smileRandomForest(50).train({
  features: trainingData,
  classProperty: classProperty,
  inputProperties: bands
});

// 使用分类器对影像进行分类
var classified = composite.classify(classifier);

// 获取唯一的类别值
var uniqueValues = training.aggregate_array(classProperty).distinct();
print('Unique Class Values:', uniqueValues);

// 添加分类结果显示
var classificationVis = {
  min: 0,
  max: 5,
  palette: ['red', 'green', 'blue', 'yellow', 'gray', 'brown']
};

// 添加分类结果到地图
Map.addLayer(classified, classificationVis, 'Classification Result');

// 导出分类结果
Export.image.toDrive({
  image: classified,
  description: 'Land_Use_Classification_2018',
  folder: 'GEE_Landsat8_RandomForest_Classification',
  fileNamePrefix: 'Land_Use_2018',
  region: region.geometry().bounds(),
  scale: 30,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// 输出随机森林模型的特征重要性
print('Random Forest Feature Importance:', classifier.explain());