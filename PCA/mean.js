var geometry = ee.FeatureCollection("projects/my-project-1684574041697/assets/hys");



function rmCloud (image){
  var qa = image.select('QA_PIXEL');
  var cloudShadowBitMask = 1 << 4;
  var cloudsBitMask = 1 << 3;
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
               .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  return image.updateMask(mask);
}
function interpolation(image){
  return image.focal_mean({
    radius: 3,  // 邻域半径
    kernelType: 'circle',  // 或'square'
    units: 'pixels'  // 或'meters'
  });

}
var startYear = 2023;
var endYear = 2024;
var years = ee.List.sequence(startYear,endYear);
var yearlylist  = [];
for (var y = startYear; y <= endYear; y++) {
  // 加载 Landsat 8/9 数据集
  var startDate = ee.Date.fromYMD(y, 1, 1);
  var endDate = ee.Date.fromYMD(y, 12, 31);
    var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')  // Landsat 8
        .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))    // Landsat 9
        .filter(ee.Filter.date(startDate, endDate))
        .filterBounds(geometry)
        .select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7', 'ST_B10', 'QA_PIXEL'])
        //.filter(ee.Filter.lt('CLOUD_COVER', 25))
        .map(rmCloud);
    ;
        print(landsat)
    var re_image = landsat.median();
    function calculateIndices(image) {
      // 应用缩放因子
      var optical = image.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'])
        .multiply(0.0000275).add(-0.2);  // 光学波段的缩放
      var thermal = image.select(['ST_B10'])
        .multiply(0.00341802).add(149.0);  // 热红外波段的缩放
      // 重命名波段以便计算
      optical = optical.select(
        ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7'],
        ['Blue', 'Green', 'Red', 'NIR', 'SWIR1', 'SWIR2']
      );
      // 湿度指数 - Tasseled Cap Wetness for Landsat 8/9 OLI
      var wetness = optical.expression(
        'Blue * 0.1511 + Green * 0.1973 + Red * 0.3283 + NIR * 0.3407 + SWIR1 * (-0.7117) + SWIR2 * (-0.4559)',
        {
          'Blue': optical.select('Blue'),
          'Green': optical.select('Green'),
          'Red': optical.select('Red'),
          'NIR': optical.select('NIR'),
          'SWIR1': optical.select('SWIR1'),
          'SWIR2': optical.select('SWIR2')
        }
      ).rename('wetness');
      // 绿度指数 - NDVI (-1 到 1)
      var ndvi = optical.normalizedDifference(['NIR', 'Red'])
        .rename('greenness');

      // 干度指数 - NDBSI
      // 1. 计算 SI (Soil Index)
      var si = optical.expression(
        '((SWIR1 + Red) - (NIR + Blue)) / ((SWIR1 + Red) + (NIR + Blue))',
        {
          'SWIR1': optical.select('SWIR1'),
          'Red': optical.select('Red'),
          'NIR': optical.select('NIR'),
          'Blue': optical.select('Blue')
        }
      );
      // 2. 计算 IBI (Index-based Built-up Index)
      var ibi = optical.expression(
        '(2 * SWIR1 / (SWIR1 + NIR) - (NIR / (NIR + Red) + Green / (Green + SWIR1))) / ' +
        '(2 * SWIR1 / (SWIR1 + NIR) + (NIR / (NIR + Red) + Green / (Green + SWIR1)))',
        {
          'SWIR1': optical.select('SWIR1'),
          'NIR': optical.select('NIR'),
          'Red': optical.select('Red'),
          'Green': optical.select('Green')
        }
      );
      // 3. 计算 NDBSI (Normalized Difference Bare Soil Index)
      var ndbsi = si.add(ibi).divide(2)
        .rename('dryness');
      // 热度指数 - 使用地表温度
      var lst = thermal.select(['ST_B10'])
        .subtract(273.15)  // 转换为摄氏度
        .rename('heat');
      return image.addBands([wetness, ndvi, ndbsi, lst]);
    }
    // 对影像集应用指数计算并获取均值影像
    re_image = calculateIndices(re_image)

    // 分别获取四个指标的均值影像并插值
    var greenness = interpolation(re_image.select('greenness'));
    var wetness = interpolation(re_image.select('wetness'));
    var heat = interpolation(re_image.select('heat'));
    var dryness = interpolation(re_image.select('dryness'));
    // 直接使用研究区实际边界
    var region = geometry;
    // 设置投影信息和计算参数
    var projection = 'EPSG:4546'; // CGCS2000 / 3-degree Gauss-Kruger CM 111E
    var scale = 30;  // Landsat 的空间分辨率

    // 将四个指标标准化用于PCA计算
    function standardizeForPCA(image) {
      var stats = image.reduceRegion({
        reducer: ee.Reducer.minMax(),
        geometry: region,
        scale: scale,
        maxPixels: 1e13
      });
      var min = ee.Number(stats.values().get(0));  // 获取最小值
      var max = ee.Number(stats.values().get(1));  // 获取最大值
      return image.subtract(min).divide(max.subtract(min));
    }


    // 标准化四个指标
    var greenness_std = standardizeForPCA(greenness);
    var wetness_std = standardizeForPCA(wetness);
    var heat_std = standardizeForPCA(heat);
    var dryness_std = standardizeForPCA(dryness);

    // 组合标准化后的指标用于PCA
    var compositeImage = ee.Image.cat([greenness_std, wetness_std, heat_std, dryness_std]);
    // PCA 计算函数
    function calculatePCA(image) {
      var scale = 30;
      var bandNames = image.bandNames();
      // 计算均值
      var meanDict = image.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: region,
        scale: scale,
        maxPixels: 1e13
      });

      // 中心化
      var means = ee.Image.constant(meanDict.values(bandNames));
      var centered = image.subtract(means);

      // 转换为数组
      var arrays = centered.toArray();
      // 计算协方差矩阵
      var covar = arrays.reduceRegion({
        reducer: ee.Reducer.centeredCovariance(),
        geometry: region,
        scale: scale,
        maxPixels: 1e13
      });

    

      // 特征值分解
      var covarArray = ee.Array(covar.get('array'));
      var eigens = covarArray.eigen();
      var eigenValues = eigens.slice(1,0,1);
      // print('eigenValues:',eigenValues);
      // 获取特征向量
      var eigenVectors = eigens.slice(1, 1);
      // print('eigenVectors:',eigenVectors);
      // 获取贡献率
      var eigenValuesList = eigenValues.toList().flatten();
      var total = eigenValuesList.reduce(ee.Reducer.sum());
      var percentageVariance = eigenValuesList.map(function(item){
        return (ee.Number(item).divide(total)).multiply(100).format('%.2f');
      });
      // print('percentageVariance:',percentageVariance)
      // --------------------------------------------------------------------------------
        // 1. 准备特征值数据
      var eigenValuesFormatted = eigenValuesList.map(function(val) {
        return ee.Number(val).format('%.4f');
      });
      
      // 2. 准备特征向量数据(转置以便每行对应一个PC)
      var eigenVectorsTransposed = eigenVectors.transpose();
      var vectorList = eigenVectorsTransposed.toList();
      
      // // 3. 准备贡献率数据
      // var percentageFormatted = percentageVariance.map(function(p) {
      //   return ee.Number(p).format('%.2f');
      // });
      
      // 4. 创建包含所有结果的FeatureCollection
      var features = ee.FeatureCollection(
        ee.List.sequence(0, eigenValuesList.size().subtract(1)).map(function(i) {
          var pcIndex = ee.Number(i).add(1);
          var vectorComponents = ee.List(vectorList.get(i)).map(function(comp) {
            return ee.Number(comp).format('%.6f');
          });
          
          return ee.Feature(null, {
            'PC': ee.String('PC').cat(pcIndex.format('%d')),
            'Eigenvalue': eigenValuesFormatted.get(i),
            'Percentage': percentageVariance.get(i),
            'VectorComponents': vectorComponents
          });
          })
      );
      // -----------------------------------------------------------------------------------

      // 获取PC1的系数（第一列）
      var ndviCoef = eigenVectors.get([0, 0]);
      var lstCoef = eigenVectors.get([1, 0]);
      var wetCoef = eigenVectors.get([2, 0]);
      var ndbsiCoef = eigenVectors.get([3, 0]);
      // 创建调整矩阵
      var adjustMatrix = ee.Array([
        [ee.Number(ndviCoef).lt(0).multiply(2).subtract(1), 0, 0, 0],
        [0, ee.Number(lstCoef).gt(0).multiply(2).subtract(1), 0, 0],
        [0, 0, ee.Number(wetCoef).lt(0).multiply(2).subtract(1), 0],
        [0, 0, 0, ee.Number(ndbsiCoef).gt(0).multiply(2).subtract(1)]
      ]);
      // 调整特征向量
      var adjustedEigenVectors = eigenVectors.matrixMultiply(adjustMatrix);
      // 将调整后的特征向量转换为图像格式
      var eigenImage = ee.Image(adjustedEigenVectors);
      // 计算主成分
      var arrayImage = arrays.toArray(1);
      var principalComponents = eigenImage.matrixMultiply(arrayImage);
      return principalComponents
        .arrayProject([0])
        .arrayFlatten([['PC1', 'PC2', 'PC3', 'PC4']]);
    }

    // 计算主成分（使用标准化后的数据）
    var principalComponents = calculatePCA(compositeImage);

    // 计算 RSEI₀（直接使用PC1，因为已经调整了方向）
    var rsei0 = principalComponents.select('PC1');



    // 标准化到0-1范围
    var rsei = rsei0.unitScale(
      rsei0.reduceRegion({
        reducer: ee.Reducer.min(),
        geometry: region,
        scale: scale,
        maxPixels: 1e13
      }).values().get(0),
      rsei0.reduceRegion({
        reducer: ee.Reducer.max(),
        geometry: region,
        scale: scale,
        maxPixels: 1e13
      }).values().get(0)
    );


    yearlylist.push(rsei.clip(region).set("year", y) 
    .set("month", 1)
    .set('date', ee.Date.fromYMD(y,1,1))
    .set("system:time_start", ee.Date.fromYMD(y, 1, 1)));
}
var yearly = ee.ImageCollection.fromImages(yearlylist);

//计算每年均值
print(ui.Chart.image.series(yearly , geometry , ee.Reducer.mean()));