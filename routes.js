const routes = [
  {
    "id": "L002",
    "name": "狭山線",
    "stations": [
      {
        "id": "S0145NT",
        "name": "西所沢",
        "x": 216,
        "y": 330
      },
      {
        "id": "S0210SI",
        "name": "下山口",
        "x": 546,
        "y": 330
      },
      {
        "id": "S0215SK",
        "name": "西武球場前",
        "x": 876,
        "y": 384
      }
    ],
    "links": [
      {
        "from": "S0145NT",
        "to": "S0210SI"
      },
      {
        "from": "S0210SI",
        "to": "S0145NT"
      },
      {
        "from": "S0210SI",
        "to": "S0215SK"
      },
      {
        "from": "S0215SK",
        "to": "S0210SI"
      }
    ]
  },
  {
    "id": "L012",
    "name": "国分寺線",
    "stations": [
      {
        "id": "S1510TJ",
        "name": "国分寺",
        "x": 48,
        "y": 330
      },
      {
        "id": "S1532KG",
        "name": "恋ヶ窪",
        "x": 378,
        "y": 330
      },
      {
        "id": "S1533TD",
        "name": "鷹の台",
        "x": 708,
        "y": 330
      },
      {
        "id": "S1534OG",
        "name": "小川",
        "x": 1038,
        "y": 384
      },
      {
        "id": "S1435HM",
        "name": "東村山",
        "x": 1422,
        "y": 330
      }
    ],
    "links": [
      {
        "from": "S1510TJ",
        "to": "S1532KG"
      },
      {
        "from": "S1532KG",
        "to": "S1510TJ"
      },
      {
        "from": "S1532KG",
        "to": "S1533TD"
      },
      {
        "from": "S1533TD",
        "to": "S1532KG"
      },
      {
        "from": "S1533TD",
        "to": "S1534OG"
      },
      {
        "from": "S1534OG",
        "to": "S1533TD"
      },
      {
        "from": "S1534OG",
        "to": "S1435HM"
      },
      {
        "from": "S1435HM",
        "to": "S1534OG"
      }
    ]
  },
  {
    "id": "L021",
    "name": "多摩川線",
    "stations": [
      {
        "id": "S2801XM",
        "name": "武蔵境",
        "x": 42,
        "y": 330
      },
      {
        "id": "S2802XS",
        "name": "新小金井",
        "x": 372,
        "y": 330
      },
      {
        "id": "S2803XT",
        "name": "多磨",
        "x": 702,
        "y": 330
      },
      {
        "id": "S2804XI",
        "name": "白糸台",
        "x": 1032,
        "y": 330
      },
      {
        "id": "S2805XK",
        "name": "競艇場前",
        "x": 1362,
        "y": 330
      },
      {
        "id": "S2806XR",
        "name": "是政",
        "x": 1692,
        "y": 330
      }
    ],
    "links": [
      {
        "from": "S2801XM",
        "to": "S2802XS"
      },
      {
        "from": "S2802XS",
        "to": "S2801XM"
      },
      {
        "from": "S2802XS",
        "to": "S2803XT"
      },
      {
        "from": "S2803XT",
        "to": "S2802XS"
      },
      {
        "from": "S2803XT",
        "to": "S2804XI"
      },
      {
        "from": "S2804XI",
        "to": "S2803XT"
      },
      {
        "from": "S2804XI",
        "to": "S2805XK"
      },
      {
        "from": "S2805XK",
        "to": "S2804XI"
      },
      {
        "from": "S2805XK",
        "to": "S2806XR"
      },
      {
        "from": "S2806XR",
        "to": "S2805XK"
      }
    ]
  },
  {
    "id": "L011",
    "name": "拝島線",
    "stations": [
      {
        "id": "S1430KO",
        "name": "小平",
        "x": 252,
        "y": 330
      },
      {
        "id": "S1515HG",
        "name": "萩山",
        "x": 582,
        "y": 384
      },
      {
        "id": "S1534OG",
        "name": "小川",
        "x": 966,
        "y": 384
      },
      {
        "id": "S1540HY",
        "name": "東大和市",
        "x": 1350,
        "y": 330
      },
      {
        "id": "S1545TA",
        "name": "玉川上水",
        "x": 1680,
        "y": 330
      },
      {
        "id": "S1546MS",
        "name": "武蔵砂川",
        "x": 2010,
        "y": 330
      },
      {
        "id": "S1547SE",
        "name": "西武立川",
        "x": 2340,
        "y": 330
      },
      {
        "id": "S1550HJ",
        "name": "拝島",
        "x": 2670,
        "y": 330
      }
    ],
    "links": [
      {
        "from": "S1430KO",
        "to": "S1515HG"
      },
      {
        "from": "S1515HG",
        "to": "S1430KO"
      },
      {
        "from": "S1515HG",
        "to": "S1534OG"
      },
      {
        "from": "S1534OG",
        "to": "S1515HG"
      },
      {
        "from": "S1534OG",
        "to": "S1540HY"
      },
      {
        "from": "S1540HY",
        "to": "S1534OG"
      },
      {
        "from": "S1540HY",
        "to": "S1545TA"
      },
      {
        "from": "S1545TA",
        "to": "S1540HY"
      },
      {
        "from": "S1545TA",
        "to": "S1546MS"
      },
      {
        "from": "S1546MS",
        "to": "S1545TA"
      },
      {
        "from": "S1546MS",
        "to": "S1547SE"
      },
      {
        "from": "S1547SE",
        "to": "S1546MS"
      },
      {
        "from": "S1547SE",
        "to": "S1550HJ"
      },
      {
        "from": "S1550HJ",
        "to": "S1547SE"
      }
    ]
  },
  {
    "id": "L022",
    "name": "山口線",
    "stations": [
      {
        "id": "S1520YU",
        "name": "多摩湖",
        "x": 192,
        "y": 384
      },
      {
        "id": "S1807QY",
        "name": "西武園ゆうえんち",
        "x": 576,
        "y": 324
      },
      {
        "id": "S0215SK",
        "name": "西武球場前",
        "x": 900,
        "y": 384
      }
    ],
    "links": [
      {
        "from": "S1520YU",
        "to": "S1807QY"
      },
      {
        "from": "S1807QY",
        "to": "S1520YU"
      },
      {
        "from": "S1807QY",
        "to": "S0215SK"
      },
      {
        "from": "S0215SK",
        "to": "S1807QY"
      }
    ]
  },
  {
    "id": "L001",
    "name": "池袋線",
    "stations": [
      {
        "id": "S0100IK",
        "name": "池袋",
        "x": 48,
        "y": 330
      },
      {
        "id": "S0101SC",
        "name": "椎名町",
        "x": 378,
        "y": 330
      },
      {
        "id": "S0102HI",
        "name": "東長崎",
        "x": 708,
        "y": 330
      },
      {
        "id": "S0103EK",
        "name": "江古田",
        "x": 1038,
        "y": 330
      },
      {
        "id": "S0104SD",
        "name": "桜台",
        "x": 1368,
        "y": 330
      },
      {
        "id": "S0105NE",
        "name": "練馬",
        "x": 1698,
        "y": 384
      },
      {
        "id": "S0200TO",
        "name": "豊島園",
        "x": 2082,
        "y": 414
      },
      {
        "id": "S0106NM",
        "name": "中村橋",
        "x": 2496,
        "y": 330
      },
      {
        "id": "S0107HU",
        "name": "富士見台",
        "x": 2826,
        "y": 330
      },
      {
        "id": "S0110HZ",
        "name": "練馬高野台",
        "x": 3156,
        "y": 330
      },
      {
        "id": "S0115SJ",
        "name": "石神井公園",
        "x": 3486,
        "y": 330
      },
      {
        "id": "S0116OE",
        "name": "大泉学園",
        "x": 3816,
        "y": 330
      },
      {
        "id": "S0120HO",
        "name": "保谷",
        "x": 4146,
        "y": 330
      },
      {
        "id": "S0121HB",
        "name": "ひばりヶ丘",
        "x": 4476,
        "y": 330
      },
      {
        "id": "S0122HR",
        "name": "東久留米",
        "x": 4806,
        "y": 330
      },
      {
        "id": "S0130KI",
        "name": "清瀬",
        "x": 5136,
        "y": 330
      },
      {
        "id": "S0131AK",
        "name": "秋津",
        "x": 5466,
        "y": 330
      },
      {
        "id": "S0440TZ",
        "name": "所沢",
        "x": 5796,
        "y": 384
      },
      {
        "id": "S0145NT",
        "name": "西所沢",
        "x": 6180,
        "y": 384
      },
      {
        "id": "S0150KS",
        "name": "小手指",
        "x": 6564,
        "y": 330
      },
      {
        "id": "S0151SG",
        "name": "狭山ヶ丘",
        "x": 6894,
        "y": 330
      },
      {
        "id": "S0152MH",
        "name": "武蔵藤沢",
        "x": 7224,
        "y": 330
      },
      {
        "id": "S0153IN",
        "name": "稲荷山公園",
        "x": 7554,
        "y": 330
      },
      {
        "id": "S0154IM",
        "name": "入間市",
        "x": 7884,
        "y": 330
      },
      {
        "id": "S0155BU",
        "name": "仏子",
        "x": 8214,
        "y": 330
      },
      {
        "id": "S0156MJ",
        "name": "元加治",
        "x": 8544,
        "y": 330
      },
      {
        "id": "S0160HA",
        "name": "飯能",
        "x": 8874,
        "y": 384
      }
    ],
    "links": [
      {
        "from": "S0100IK",
        "to": "S0101SC"
      },
      {
        "from": "S0101SC",
        "to": "S0100IK"
      },
      {
        "from": "S0101SC",
        "to": "S0102HI"
      },
      {
        "from": "S0102HI",
        "to": "S0101SC"
      },
      {
        "from": "S0102HI",
        "to": "S0103EK"
      },
      {
        "from": "S0103EK",
        "to": "S0102HI"
      },
      {
        "from": "S0103EK",
        "to": "S0104SD"
      },
      {
        "from": "S0104SD",
        "to": "S0103EK"
      },
      {
        "from": "S0104SD",
        "to": "S0105NE"
      },
      {
        "from": "S0105NE",
        "to": "S0104SD"
      },
      {
        "from": "S0105NE",
        "to": "S0200TO"
      },
      {
        "from": "S0200TO",
        "to": "S0105NE"
      },
      {
        "from": "S0200TO",
        "to": "S0106NM"
      },
      {
        "from": "S0106NM",
        "to": "S0200TO"
      },
      {
        "from": "S0106NM",
        "to": "S0107HU"
      },
      {
        "from": "S0107HU",
        "to": "S0106NM"
      },
      {
        "from": "S0107HU",
        "to": "S0110HZ"
      },
      {
        "from": "S0110HZ",
        "to": "S0107HU"
      },
      {
        "from": "S0110HZ",
        "to": "S0115SJ"
      },
      {
        "from": "S0115SJ",
        "to": "S0110HZ"
      },
      {
        "from": "S0115SJ",
        "to": "S0116OE"
      },
      {
        "from": "S0116OE",
        "to": "S0115SJ"
      },
      {
        "from": "S0116OE",
        "to": "S0120HO"
      },
      {
        "from": "S0120HO",
        "to": "S0116OE"
      },
      {
        "from": "S0120HO",
        "to": "S0121HB"
      },
      {
        "from": "S0121HB",
        "to": "S0120HO"
      },
      {
        "from": "S0121HB",
        "to": "S0122HR"
      },
      {
        "from": "S0122HR",
        "to": "S0121HB"
      },
      {
        "from": "S0122HR",
        "to": "S0130KI"
      },
      {
        "from": "S0130KI",
        "to": "S0122HR"
      },
      {
        "from": "S0130KI",
        "to": "S0131AK"
      },
      {
        "from": "S0131AK",
        "to": "S0130KI"
      },
      {
        "from": "S0131AK",
        "to": "S0440TZ"
      },
      {
        "from": "S0440TZ",
        "to": "S0131AK"
      },
      {
        "from": "S0440TZ",
        "to": "S0145NT"
      },
      {
        "from": "S0145NT",
        "to": "S0440TZ"
      },
      {
        "from": "S0145NT",
        "to": "S0150KS"
      },
      {
        "from": "S0150KS",
        "to": "S0145NT"
      },
      {
        "from": "S0150KS",
        "to": "S0151SG"
      },
      {
        "from": "S0151SG",
        "to": "S0150KS"
      },
      {
        "from": "S0151SG",
        "to": "S0152MH"
      },
      {
        "from": "S0152MH",
        "to": "S0151SG"
      },
      {
        "from": "S0152MH",
        "to": "S0153IN"
      },
      {
        "from": "S0153IN",
        "to": "S0152MH"
      },
      {
        "from": "S0153IN",
        "to": "S0154IM"
      },
      {
        "from": "S0154IM",
        "to": "S0153IN"
      },
      {
        "from": "S0154IM",
        "to": "S0155BU"
      },
      {
        "from": "S0155BU",
        "to": "S0154IM"
      },
      {
        "from": "S0155BU",
        "to": "S0156MJ"
      },
      {
        "from": "S0156MJ",
        "to": "S0155BU"
      },
      {
        "from": "S0156MJ",
        "to": "S0160HA"
      },
      {
        "from": "S0160HA",
        "to": "S0156MJ"
      }
    ]
  },
  {
    "id": "L013",
    "name": "多摩湖線",
    "stations": [
      {
        "id": "S1510TJ",
        "name": "国分寺",
        "x": 48,
        "y": 330
      },
      {
        "id": "S1512GA",
        "name": "一橋学園",
        "x": 378,
        "y": 330
      },
      {
        "id": "S1513AO",
        "name": "青梅街道",
        "x": 708,
        "y": 330
      },
      {
        "id": "S1515HG",
        "name": "萩山",
        "x": 1038,
        "y": 384
      },
      {
        "id": "S1516YA",
        "name": "八坂",
        "x": 1422,
        "y": 330
      },
      {
        "id": "S1518MT",
        "name": "武蔵大和",
        "x": 1752,
        "y": 330
      },
      {
        "id": "S1520YU",
        "name": "多摩湖",
        "x": 2082,
        "y": 384
      }
    ],
    "links": [
      {
        "from": "S1510TJ",
        "to": "S1512GA"
      },
      {
        "from": "S1512GA",
        "to": "S1510TJ"
      },
      {
        "from": "S1512GA",
        "to": "S1513AO"
      },
      {
        "from": "S1513AO",
        "to": "S1512GA"
      },
      {
        "from": "S1513AO",
        "to": "S1515HG"
      },
      {
        "from": "S1515HG",
        "to": "S1513AO"
      },
      {
        "from": "S1515HG",
        "to": "S1516YA"
      },
      {
        "from": "S1516YA",
        "to": "S1515HG"
      },
      {
        "from": "S1516YA",
        "to": "S1518MT"
      },
      {
        "from": "S1518MT",
        "to": "S1516YA"
      },
      {
        "from": "S1518MT",
        "to": "S1520YU"
      },
      {
        "from": "S1520YU",
        "to": "S1518MT"
      }
    ]
  },
  {
    "id": "L005",
    "name": "西武有楽町線",
    "stations": [
      {
        "id": "S0315KT",
        "name": "小竹向原",
        "x": 216,
        "y": 330
      },
      {
        "id": "S0320SR",
        "name": "新桜台",
        "x": 546,
        "y": 330
      },
      {
        "id": "S0105NE",
        "name": "練馬",
        "x": 876,
        "y": 384
      }
    ],
    "links": [
      {
        "from": "S0315KT",
        "to": "S0320SR"
      },
      {
        "from": "S0320SR",
        "to": "S0315KT"
      },
      {
        "from": "S0320SR",
        "to": "S0105NE"
      },
      {
        "from": "S0105NE",
        "to": "S0320SR"
      }
    ]
  },
  {
    "id": "L009",
    "name": "新宿線",
    "stations": [
      {
        "id": "S1400SS",
        "name": "西武新宿",
        "x": 48,
        "y": 330
      },
      {
        "id": "S1401TB",
        "name": "高田馬場",
        "x": 378,
        "y": 330
      },
      {
        "id": "S1402SO",
        "name": "下落合",
        "x": 708,
        "y": 330
      },
      {
        "id": "S1403NA",
        "name": "中井",
        "x": 1038,
        "y": 330
      },
      {
        "id": "S1404AR",
        "name": "新井薬師前",
        "x": 1368,
        "y": 330
      },
      {
        "id": "S1405NU",
        "name": "沼袋",
        "x": 1698,
        "y": 330
      },
      {
        "id": "S1406NO",
        "name": "野方",
        "x": 2028,
        "y": 330
      },
      {
        "id": "S1407TK",
        "name": "都立家政",
        "x": 2358,
        "y": 330
      },
      {
        "id": "S1408SA",
        "name": "鷺ノ宮",
        "x": 2688,
        "y": 330
      },
      {
        "id": "S1409SM",
        "name": "下井草",
        "x": 3018,
        "y": 330
      },
      {
        "id": "S1410IG",
        "name": "井荻",
        "x": 3348,
        "y": 330
      },
      {
        "id": "S1411KM",
        "name": "上井草",
        "x": 3678,
        "y": 330
      },
      {
        "id": "S1420KA",
        "name": "上石神井",
        "x": 4008,
        "y": 330
      },
      {
        "id": "S1421MK",
        "name": "武蔵関",
        "x": 4338,
        "y": 330
      },
      {
        "id": "S1422HF",
        "name": "東伏見",
        "x": 4668,
        "y": 330
      },
      {
        "id": "S1423SY",
        "name": "西武柳沢",
        "x": 4998,
        "y": 330
      },
      {
        "id": "S1425TN",
        "name": "田無",
        "x": 5328,
        "y": 330
      },
      {
        "id": "S1426HK",
        "name": "花小金井",
        "x": 5658,
        "y": 330
      },
      {
        "id": "S1430KO",
        "name": "小平",
        "x": 5988,
        "y": 384
      },
      {
        "id": "S1431KU",
        "name": "久米川",
        "x": 6372,
        "y": 330
      },
      {
        "id": "S1435HM",
        "name": "東村山",
        "x": 6702,
        "y": 384
      },
      {
        "id": "S1500SB",
        "name": "西武園",
        "x": 7086,
        "y": 330
      },
      {
        "id": "S0440TZ",
        "name": "所沢",
        "x": 7416,
        "y": 384
      },
      {
        "id": "S1441KK",
        "name": "航空公園",
        "x": 7800,
        "y": 330
      },
      {
        "id": "S1445ST",
        "name": "新所沢",
        "x": 8130,
        "y": 330
      },
      {
        "id": "S1451IR",
        "name": "入曽",
        "x": 8460,
        "y": 330
      },
      {
        "id": "S1455SH",
        "name": "狭山市",
        "x": 8790,
        "y": 330
      },
      {
        "id": "S1456SN",
        "name": "新狭山",
        "x": 9120,
        "y": 330
      },
      {
        "id": "S1457MO",
        "name": "南大塚",
        "x": 9450,
        "y": 330
      },
      {
        "id": "S1460HE",
        "name": "本川越",
        "x": 9780,
        "y": 330
      }
    ],
    "links": [
      {
        "from": "S1400SS",
        "to": "S1401TB"
      },
      {
        "from": "S1401TB",
        "to": "S1400SS"
      },
      {
        "from": "S1401TB",
        "to": "S1402SO"
      },
      {
        "from": "S1402SO",
        "to": "S1401TB"
      },
      {
        "from": "S1402SO",
        "to": "S1403NA"
      },
      {
        "from": "S1403NA",
        "to": "S1402SO"
      },
      {
        "from": "S1403NA",
        "to": "S1404AR"
      },
      {
        "from": "S1404AR",
        "to": "S1403NA"
      },
      {
        "from": "S1404AR",
        "to": "S1405NU"
      },
      {
        "from": "S1405NU",
        "to": "S1404AR"
      },
      {
        "from": "S1405NU",
        "to": "S1406NO"
      },
      {
        "from": "S1406NO",
        "to": "S1405NU"
      },
      {
        "from": "S1406NO",
        "to": "S1407TK"
      },
      {
        "from": "S1407TK",
        "to": "S1406NO"
      },
      {
        "from": "S1407TK",
        "to": "S1408SA"
      },
      {
        "from": "S1408SA",
        "to": "S1407TK"
      },
      {
        "from": "S1408SA",
        "to": "S1409SM"
      },
      {
        "from": "S1409SM",
        "to": "S1408SA"
      },
      {
        "from": "S1409SM",
        "to": "S1410IG"
      },
      {
        "from": "S1410IG",
        "to": "S1409SM"
      },
      {
        "from": "S1410IG",
        "to": "S1411KM"
      },
      {
        "from": "S1411KM",
        "to": "S1410IG"
      },
      {
        "from": "S1411KM",
        "to": "S1420KA"
      },
      {
        "from": "S1420KA",
        "to": "S1411KM"
      },
      {
        "from": "S1420KA",
        "to": "S1421MK"
      },
      {
        "from": "S1421MK",
        "to": "S1420KA"
      },
      {
        "from": "S1421MK",
        "to": "S1422HF"
      },
      {
        "from": "S1422HF",
        "to": "S1421MK"
      },
      {
        "from": "S1422HF",
        "to": "S1423SY"
      },
      {
        "from": "S1423SY",
        "to": "S1422HF"
      },
      {
        "from": "S1423SY",
        "to": "S1425TN"
      },
      {
        "from": "S1425TN",
        "to": "S1423SY"
      },
      {
        "from": "S1425TN",
        "to": "S1426HK"
      },
      {
        "from": "S1426HK",
        "to": "S1425TN"
      },
      {
        "from": "S1426HK",
        "to": "S1430KO"
      },
      {
        "from": "S1430KO",
        "to": "S1426HK"
      },
      {
        "from": "S1430KO",
        "to": "S1431KU"
      },
      {
        "from": "S1431KU",
        "to": "S1430KO"
      },
      {
        "from": "S1431KU",
        "to": "S1435HM"
      },
      {
        "from": "S1435HM",
        "to": "S1431KU"
      },
      {
        "from": "S1435HM",
        "to": "S1500SB"
      },
      {
        "from": "S1500SB",
        "to": "S1435HM"
      },
      {
        "from": "S1500SB",
        "to": "S0440TZ"
      },
      {
        "from": "S0440TZ",
        "to": "S1500SB"
      },
      {
        "from": "S0440TZ",
        "to": "S1441KK"
      },
      {
        "from": "S1441KK",
        "to": "S0440TZ"
      },
      {
        "from": "S1441KK",
        "to": "S1445ST"
      },
      {
        "from": "S1445ST",
        "to": "S1441KK"
      },
      {
        "from": "S1445ST",
        "to": "S1451IR"
      },
      {
        "from": "S1451IR",
        "to": "S1445ST"
      },
      {
        "from": "S1451IR",
        "to": "S1455SH"
      },
      {
        "from": "S1455SH",
        "to": "S1451IR"
      },
      {
        "from": "S1455SH",
        "to": "S1456SN"
      },
      {
        "from": "S1456SN",
        "to": "S1455SH"
      },
      {
        "from": "S1456SN",
        "to": "S1457MO"
      },
      {
        "from": "S1457MO",
        "to": "S1456SN"
      },
      {
        "from": "S1457MO",
        "to": "S1460HE"
      },
      {
        "from": "S1460HE",
        "to": "S1457MO"
      }
    ]
  },
  {
    "id": "L008",
    "name": "西武秩父線",
    "stations": [
      {
        "id": "S0160HA",
        "name": "飯能",
        "x": 48,
        "y": 384
      },
      {
        "id": "S0161HH",
        "name": "東飯能",
        "x": 432,
        "y": 330
      },
      {
        "id": "S0166CK",
        "name": "高麗",
        "x": 762,
        "y": 330
      },
      {
        "id": "S0167CM",
        "name": "武蔵横手",
        "x": 1092,
        "y": 330
      },
      {
        "id": "S0168CH",
        "name": "東吾野",
        "x": 1422,
        "y": 330
      },
      {
        "id": "S0170CA",
        "name": "吾野",
        "x": 1752,
        "y": 330
      },
      {
        "id": "S0175CN",
        "name": "西吾野",
        "x": 2082,
        "y": 330
      },
      {
        "id": "S0176CS",
        "name": "正丸",
        "x": 2412,
        "y": 330
      },
      {
        "id": "S0178CB",
        "name": "芦ヶ久保",
        "x": 2742,
        "y": 330
      },
      {
        "id": "S0179CY",
        "name": "横瀬",
        "x": 3072,
        "y": 330
      },
      {
        "id": "S0180CC",
        "name": "西武秩父",
        "x": 3402,
        "y": 330
      }
    ],
    "links": [
      {
        "from": "S0160HA",
        "to": "S0161HH"
      },
      {
        "from": "S0161HH",
        "to": "S0160HA"
      },
      {
        "from": "S0161HH",
        "to": "S0166CK"
      },
      {
        "from": "S0166CK",
        "to": "S0161HH"
      },
      {
        "from": "S0166CK",
        "to": "S0167CM"
      },
      {
        "from": "S0167CM",
        "to": "S0166CK"
      },
      {
        "from": "S0167CM",
        "to": "S0168CH"
      },
      {
        "from": "S0168CH",
        "to": "S0167CM"
      },
      {
        "from": "S0168CH",
        "to": "S0170CA"
      },
      {
        "from": "S0170CA",
        "to": "S0168CH"
      },
      {
        "from": "S0170CA",
        "to": "S0175CN"
      },
      {
        "from": "S0175CN",
        "to": "S0170CA"
      },
      {
        "from": "S0175CN",
        "to": "S0176CS"
      },
      {
        "from": "S0176CS",
        "to": "S0175CN"
      },
      {
        "from": "S0176CS",
        "to": "S0178CB"
      },
      {
        "from": "S0178CB",
        "to": "S0176CS"
      },
      {
        "from": "S0178CB",
        "to": "S0179CY"
      },
      {
        "from": "S0179CY",
        "to": "S0178CB"
      },
      {
        "from": "S0179CY",
        "to": "S0180CC"
      },
      {
        "from": "S0180CC",
        "to": "S0179CY"
      }
    ]
  }
];