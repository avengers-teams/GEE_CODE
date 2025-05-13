var oeel=require('users/OEEL/lib:loadAll');
//研究区shp
var roi = ee.FeatureCollection("projects/my-project-1684574041697/assets/region");
Map.addLayer(roi,{'color':'grey'},'studyArea');
Map.centerObject(roi);
var startYear = 2005;
var endYear = 2024;
//数据集名称
var data_set = "MODIS/061/MCD15A3H"
//需要的波段
var need_band = "Lai"
//是否启用插值
var need_interpolation = false
//重采样大小
var scale = 5000

var startMonth = 1;
var endMonth = 12;
for (var year = startYear; year <= endYear; year++) {
  for (var month = startMonth; month <= endMonth; month++) {

  var startDate = ee.Date.fromYMD(year, month, 1);
  var endDate = ee.Date.fromYMD(year, month, 28);
  var img = ee.ImageCollection(data_set)
                    .filter(ee.Filter.date(startDate, endDate))
                    .select(need_band)
                    .mean()
                    .clip(roi);
  if(need_interpolation){
    var covFun = function(dist) {
      return dist.multiply(-0.1).exp().multiply(140);
    };
    var k_img = oeel.Image.kriging({
      covFun: covFun,
      radius: 15,  // 插值时考虑的半径范围
      image: img
    });
    
    img = img.unmask(k_img.select('estimate').clip(roi));
  }                  
  img = img.clip(roi).reproject({
    crs: 'EPSG:4326', 
    scale: scale        
  });
  print(img)
  var fileName = need_band+'_' + year+'_' +month ;
  Export.image.toDrive({
    image: img,  // 要导出的图像
    description: fileName,  // 导出的文件名
    folder: 'GEE_Folder_'+need_band+'_'+(scale/1000).toString()+'km',  // 存储的文件夹名
    region: roi,
    scale: scale,
    maxPixels: 1e8  // 设置最大像素
  });
  }
}