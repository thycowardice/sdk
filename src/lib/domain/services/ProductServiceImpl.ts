import fs from 'fs';
import * as cheerio from 'cheerio';
import BaseService from './base/BaseClient';
import ApiEndpoints from '../../core/api/ApiEndPoint';
import type HttpClient from '../../core/api/HttpClient';
import type { CollectionBoothProduct, DownloadableData, DownloadStats, ListingFilter } from '../../@types/services/ProductService';
import type { Category, Downloadable, Images, Shop } from '../../@types/services/dto/Dto';
import BoothProductOverviewDto from '../dto/BoothProductOverviewDto';
import BoothProductDto from '../dto/BoothProductDto';
import DirManager from '../../utils/DirManager';

export default class ProductServiceImpl extends BaseService {
  private readonly _httpclient: HttpClient;

  constructor (httpclient: HttpClient) {
    super();
    this._httpclient = httpclient;
  }

  public async listProducts (index?: number, filterOn?: ListingFilter): Promise<CollectionBoothProduct> {
    let param: string | undefined;
    if (filterOn) {
      switch (filterOn.filter) {
        case 'New':
          param = 'new';
          break;
        case 'Popularity':
          param = 'popularity';
          break;
        case 'Loves':
          param = 'wish_lists';
          break;
        default:
          throw new Error('Invalid_filter_provided.');
      }
    }
    const wsData = await this.performRequest(async () =>
      await this._httpclient.get(ApiEndpoints.products.listProducts(index, param))
    );
    return this._extractProducts(wsData);
  }

  public async getProduct (articleId: number): Promise<any | null> {
    try {
      if (!Number(articleId)) {
        throw new Error('Product id is not a number');
      }
      const wsData: any = await this.performRequest(async () =>
        await this._httpclient.get(ApiEndpoints.products.getById(articleId)));

      const category: Category = {
        id: wsData.category.id,
        name: wsData.category.name
      };

      const images: Images[] = wsData.images.map((image: Images) => ({
        original: image.original,
        resized: image.resized
      }));

      const shop: Shop = {
        name: wsData.shop.name,
        subdomain: wsData.shop.subdomain,
        thumbnail: wsData.shop.thumbnail_url,
        url: wsData.shop.url
      };

      const boothProduct = new BoothProductDto(
        Number(wsData.id),
        String(wsData.description),
        category,
        String(wsData.name),
        String(wsData.price),
        images,
        shop,
        Boolean(wsData.is_adult),
        Number(wsData.wish_lists_count),
        wsData.variations[0].downloadable.no_musics as Downloadable
      );

      return boothProduct;
    } catch (error: any) {
      if (error.code === 'ERR_BAD_REQUEST') {
        return null;
      } else {
        throw new Error(`Error: ${error.message}`);
      }
    }
  }

  public async search (term: string, filterOn?: ListingFilter): Promise<CollectionBoothProduct> {
    if (!term) {
      throw new Error('term is not provided.');
    }
    let param: string | undefined;

    if (filterOn) {
      switch (filterOn.filter) {
        case 'New':
          param = 'new';
          break;
        case 'Popularity':
          param = undefined;
          break;
        case 'Loves':
          param = 'wish_lists';
          break;
        default:
          throw new Error('Invalid_filter_provided');
      }
    }

    const wsData = await this.performRequest(async () =>
      await this._httpclient.get(ApiEndpoints.products.search(term, param))
    );
    return this._extractProducts(wsData);
  }

  public async download (downloadableData: DownloadableData): Promise<DownloadStats> {
    const downloadLinks: any = downloadableData.boothProduct.downloadable;

    let successfulDownloads: number = 0;
    let failedDownloads: number = 0;
    for (const linkInfo of downloadLinks) {
      try {
        const wsData = await this.performRequest(async () =>
          await this._httpclient.stream(ApiEndpoints.products.save(linkInfo.url as string)));
        if (!await DirManager.folderExists(`${downloadableData.path}`)) {
          await DirManager.createDir((`${downloadableData.path}`));
        }
        const file: fs.WriteStream = fs.createWriteStream(`${downloadableData.path}/${linkInfo.name}`);
        wsData.pipe(file);
        await new Promise<void>((resolve, reject) => {
          file.on('finish', () => {
            successfulDownloads++;
            resolve();
          });
          file.on('error', (error) => {
            failedDownloads++;
            reject(error);
          });
        });
      } catch (e) {
        failedDownloads++;
      }
    }
    return { successfulDownloads, failedDownloads };
  }

  private _extractProducts (html: any): CollectionBoothProduct {
    const $ = cheerio.load(html as string);

    const ageVerification: string = $('#age-confirmation .u-tpg-title1.u-m-0').text();
    if (ageVerification) {
      throw new Error('Adulte_Content_is_not_enabled');
    }

    const elements = $('.l-cards-5cols li[data-product-id]');
    let totalArticle: string = $('.container b').text();
    let count: number = 0;

    if (totalArticle && totalArticle.trim() !== '') {
      totalArticle = totalArticle.replace(/\D/g, '');
      count = Math.ceil(Number(totalArticle) / 60);
    }

    const itemsData: BoothProductOverviewDto[] = [];
    elements.each((_index, element) => {
      const productId = $(element).attr('data-product-id');
      const productBrand = $(element).attr('data-product-brand');
      const productCategory = $(element).attr('data-product-category');
      const productName = $(element)
        .find('.item-card__title-anchor--multiline')
        .text()
        .trim();
      const productPrice = $(element).attr('data-product-price');
      const imageURL = $(element)
        .find('.js-thumbnail-image')
        .attr('data-original');
      const shopName = $(element)
        .find('.item-card__shop-info .item-card__shop-name')
        .text()
        .trim();
      const shopURL = $(element)
        .find('.item-card__shop-info .item-card__shop-name-anchor')
        .attr('href');
      const shopImageURL = $(element)
        .find('.item-card__shop-info .user-avatar')
        .attr('src');

      const boothProductOverview = new BoothProductOverviewDto(
        Number(productId),
        String(productBrand),
        Number(productCategory),
        productName,
        Number(productPrice),
        imageURL,
        shopName,
        String(shopURL),
        String(shopImageURL)
      );

      itemsData.push(boothProductOverview);
    });

    const collectionBoothProduct: CollectionBoothProduct = {
      totalPage: count,
      items: itemsData
    };

    return collectionBoothProduct;
  }
}
