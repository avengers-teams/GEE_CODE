
var region = ee.FeatureCollection("projects/ee-yzr5977/assets/hefei");

var startYear = 2014;
var endYear = 2024;

var startMonth = 6;
var endMonth = 9;

// 云掩膜处理
function maskL8sr(image) {
  // 获取QA像素波段
  var qa = image.select('QA_PIXEL');
  
  // 定义云掩膜，标记云和阴影 (bit 3 和 bit 4)
  var cloudShadowBitMask = 1 << 4;
  var cloudsBitMask = 1 << 3;
  
  // 创建掩膜条件，去除云和阴影
  var mask = qa.bitwiseAnd(cloudShadowBitMask).eq(0)
               .and(qa.bitwiseAnd(cloudsBitMask).eq(0));
  
  // 应用掩膜到影像，并返回处理后的影像
  return image.updateMask(mask);
}


for (var year = startYear; year <= endYear; year++) {
  
  var startDate = ee.Date.fromYMD(year, startMonth, 1);
  var endDate = ee.Date.fromYMD(year, endMonth, 30);
  
  // 加载Landsat 8 Collection 2 Level 2影像集并应用云掩膜
  var landsat8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
                  .filterBounds(region) // 使用SHP文件区域
                  .filterDate(startDate, endDate) // 筛选日期范围
                  .filter(ee.Filter.lt('CLOUD_COVER', 10))
                  .map(maskL8sr); // 应用云掩膜处理
  
  var selectedBands = landsat8.select(['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7']);
  
  // 对影像进行按时间的中值合成
  var composite = selectedBands.median().clip(region);
  
  var fileName = 'Hefei_Landuse_' + year;
  
  // 导出影像为GeoTIFF文件
  Export.image.toDrive({
    image: composite,
    description: fileName, // 导出的文件描述
    folder: 'GEE_Landsat8_With_Mask_1', // Google Drive中的文件夹
    fileNamePrefix: fileName, // 文件名前缀
    region: region.geometry().bounds(), // 使用SHP文件区域裁剪
    scale: 30, // 分辨率，Landsat 8的分辨率为30米
    crs: 'EPSG:4326', // 坐标系 (WGS 84)
    maxPixels: 1e13 // 最大像素数限制
  });
}
