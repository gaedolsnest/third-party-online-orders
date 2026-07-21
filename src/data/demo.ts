import type { OnlineOrder, OrderStatus } from '../types'
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString()
const base = (order_no:string, status:OrderStatus, days:number, line_no=1): OnlineOrder => ({
  source_no:order_no.slice(-4),source_flag:'F',order_no,line_no,store_code:'0001',store_name:'FD 광주충장로NC점',sale_type:'판매',brand:'ADIDAS',product_name:'OZWAVE SANDAL',style_code:'KJ5964',color:'CWHITE/SILVMT/CBLACK',size:'235',quantity:1,stock_quantity:1,regular_price:79000,sale_amount:63000,shipping_type:'타매장 요청',status,store_transfer_status:'점입확정',registered_at:ago(days),shipped_at:status==='출고'?ago(days-1):null,shipped_by:status==='출고'?'김담당':'',settled_at:status==='정산'?ago(1):null,settled_by:status==='정산'?'이담당':'',sales_date:null,pos_no:'',transaction_no:''
})
export const demoOrders: OnlineOrder[] = [base('ON-260721-1042','등록',4),base('ON-260720-0981','출고',8),base('ON-260719-0874','등록',1),base('ON-260718-0766','정산',8),{...base('ON-260717-0652','출고',7),store_code:'0002',store_name:'FD 홍대점'}]
