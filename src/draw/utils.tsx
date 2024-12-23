import { Context } from "koishi";
import _ from "lodash";

export const ImageBuffer = async ({ buffer }: { buffer: Buffer }) => {
  return <img src={'data:image/png;base64,' + buffer.toString('base64')} />;
}

export const ProcessJellyfishImage = async (ctx: Context, image_path: string) => {
  const { Canvas, loadImage } = ctx.skia;

  //加载图片
  const image = await loadImage(image_path);

  const canvas = new Canvas(image.width, image.height);
  const skia_ctx = canvas.getContext('2d');
  skia_ctx.drawImage(image, 0, 0);

  //提取裁剪范围
  const image_data = skia_ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = image_data;
  let top = height, bottom = 0, left = width, right = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]; // 获取 alpha 通道
      if (alpha > 0) { // 非透明像素
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  // 裁剪后的宽高
  const crop_width = right - left + 1;
  const crop_height = bottom - top + 1;

  // 将新的画布宽高设置为最长边的正方形，然后放到中间
  const max = _.max([crop_width, crop_height]);
  const dx = (max - crop_width) / 2;
  const dy = (max - crop_height) / 2;
  const crop_canvas = new Canvas(max, max);
  const crop_ctx = crop_canvas.getContext('2d');
  crop_ctx.drawImage(image, left, top, crop_width, crop_height, dx, dy, crop_width, crop_height);
  return crop_canvas;
}