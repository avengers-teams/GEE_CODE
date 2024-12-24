var region = ee.FeatureCollection("projects/ee-yzr5977/assets/hefei");
var training = ee.FeatureCollection("projects/ee-yzr5977/assets/2014");

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

var startDate = ee.Date.fromYMD(2014, 6, 1);
var endDate = ee.Date.fromYMD(2014, 10, 30);

// 加载该年份的Landsat 8数据
var landsat8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                .filterBounds(region)
                .filterDate(startDate, endDate)
                .filter(ee.Filter.lt('CLOUD_COVER', 30))
                .map(maskL8sr);

// 定义要使用的波段名称
var bands = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'];

// 选择波段并计算中值合成
var composite = landsat8.select(bands).median().clip(region);

// 显示原始影像
Map.addLayer(composite, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 7000, max: 30000}, 'Landsat RGB');

// 获取训练数据中实际的类别属性名称
var propertyNames = training.first().propertyNames();
print('Available Properties in Training Data:', propertyNames);

var classProperty = 'CLASS_NAME'; 

// 确保类别属性为数值类型
var training = training.map(function(feature) {
  return feature.set(classProperty, ee.Number.parse(feature.get(classProperty)));
});

// 提取训练数据
var trainingData = composite.sampleRegions({
  collection: training,
  properties: [classProperty],
  scale: 30
});

// 构建支持向量机分类器
var classifier = ee.Classifier.libsvm().train({
  features: trainingData,
  classProperty: classProperty,
  inputProperties: bands
});

// 使用训练数据计算混淆矩阵
var confusionMatrix = classifier.confusionMatrix();
print('Confusion Matrix:', confusionMatrix);
print('Training Overall Accuracy:', confusionMatrix.accuracy());
print('Training Kappa Coefficient:', confusionMatrix.kappa());

// 使用分类器对影像进行分类
var classified = composite.classify(classifier);

// 获取唯一的类别值
var uniqueValues = training.aggregate_array(classProperty).distinct();
print('Unique Class Values:', uniqueValues);

// 导出分类结果
// 定义几何区域
var geometry = region.geometry().bounds();

// 将分类结果转换为矢量格式
var vectors = classified.reduceToVectors({
  geometry: geometry, // 添加几何参数
  geometryType: 'polygon',
  reducer: ee.Reducer.countEvery(),
  scale: 50,
  maxPixels: 1e13
});

// 导出矢量数据为SHP格式
Export.image.toDrive({
  image: classified, // 原始分类结果
  description: 'Land_Use_Classification_Raw',
  folder: 'GEE_Landsat8_SVM_Classification',
  fileNamePrefix: 'Land_Use_Classification_Raw',
  scale: 30, // 根据需要调整分辨率
  region: region.geometry().bounds(),
  maxPixels: 1e13
});


// 输出支持向量机模型的特征重要性
print('SVM Feature Importance:', classifier.explain());

// 使用测试数据集进行验证
var validation = composite.sampleRegions({
  collection: training,
  properties: [classProperty],
  scale: 30,
  tileScale: 16
});

// 分类结果与实际类别进行比较
var validated = validation.classify(classifier);

// 计算混淆矩阵
var testAccuracy = validated.errorMatrix(classProperty, 'classification');
print('Confusion Matrix:', testAccuracy);
print('Overall Accuracy:', testAccuracy.accuracy());
print('Kappa Coefficient:', testAccuracy.kappa());
var landcoverPalette = [
  'red',  
  'blue',
  'green', 
  'yellow'
];

Map.addLayer(classified, {min: 1, max: 4, palette: landcoverPalette}, 'Land Use Classification');
// 计算每个类别的像素数量
var pixelCount = classified.reduceRegion({
  reducer: ee.Reducer.frequencyHistogram(),
  geometry: region.geometry(),
  scale: 30,
  maxPixels: 1e13
}).get('classification'); // 确保只提取分类字段

// 打印像素计数结果
print('Pixel Count for each class:', pixelCount);

// 转换为字典格式
pixelCount = ee.Dictionary(pixelCount);

// 计算总像素数
var totalPixels = ee.Number(pixelCount.values().reduce(ee.Reducer.sum()));

// 打印总像素数
print('Total Pixels:', totalPixels);

// 计算每种地物所占的百分比
var landUsePercentage = pixelCount.map(function(key, value) {
  return ee.Number(value).divide(totalPixels).multiply(100);
});

// 打印每种地物的百分比
print('Land Use Percentage:', landUsePercentage);

// 将地物类别、像素数和百分比转换为表格格式
var landUseTable = ee.FeatureCollection(
  pixelCount.keys().map(function(classValue) {
    var pixelCountValue = ee.Number(pixelCount.get(classValue));
    var percentage = landUsePercentage.get(classValue);
    
    return ee.Feature(null, {
      'Class': classValue,
      'Pixel Count': pixelCountValue,
      'Percentage (%)': percentage
    });
  })
);

// 输出表格到控制台
print('Land Use Statistics Table:', landUseTable);

// 导出地物统计结果
Export.table.toDrive({
  collection: landUseTable,
  description: 'Land_Use_Statistics',
  fileFormat: 'CSV',
  folder: 'GEE_Landsat8_SVM_Classification',
  fileNamePrefix: 'Land_Use_Statistics'
});
