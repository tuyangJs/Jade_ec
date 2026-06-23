(function () {
  'use strict';

  /**
   * 代码复制模块
   * 各语言生成器注册到 codeGenerators 中，方便扩展
   */

  var codeGenerators = {};

  /**
   * 注册代码生成器
   * @param {string} lang - 语言标识
   * @param {object} generator - 生成器对象，包含各分类的生成方法
   */
  function registerGenerator(lang, generator) {
    codeGenerators[lang] = generator;
  }

  /**
   * 生成代码文本
   * @param {string} lang - 语言标识
   * @param {string} category - 分类
   * @param {object} item - 数据项
   * @param {string} [type] - 生成类型：'call' 调用代码（默认），'params' 参数声明
   * @param {string} [methodName] - 方法名（类中指定方法时使用）
   * @param {string} [className] - 类名（类中方法使用）
   * @returns {string|null}
   */
  function generateCode(lang, category, item, type, methodName, className) {
    var gen = codeGenerators[lang];
    if (!gen) return null;
    type = type || 'call';
    var key = category + '_' + type;
    var fn = gen[key];
    if (typeof fn !== 'function') return null;
    return fn(item, methodName, className);
  }

  // --- 易语言代码生成器 ---

  function formatEParam(p, byRefLabel) {
    byRefLabel = byRefLabel || '参考';
    var parts = ['.参数 ' + (p.name || '')];
    parts.push(p.dataType || '');
    var col3 = [];
    if (p.byRef) col3.push(byRefLabel);
    if (p.nullable) col3.push('可空');
    if (p.isArray) col3.push('数组');
    parts.push(col3.join(' ') || '');
    parts.push(p.remark || '');
    return parts.join(', ');
  }

  function formatMethodDecl(m) {
    var name = m.name || '';
    var returnType = m.returnType || '';
    var remark = m.remark || '';
    var params = m.params || [];
    var header = '.子程序 ' + name + ', ' + returnType + ', , ' + remark;
    if (params.length === 0) return '.版本 2\n\n' + header;
    var paramStr = params.map(function (p) { return formatEParam(p, '参考'); }).join('\n');
    return '.版本 2\n\n' + header + '\n' + paramStr;
  }

  // 调用占位：用参数名作为占位符，便于一眼看清每个位置该填什么
  function eCallArgs(params) {
    return (params || []).map(function (p, i) {
      if (p && p.name) return p.name;
      if (p && p.dataType) return p.dataType;
      return '参数' + (i + 1);
    }).join(', ');
  }

  var eGenerator = {
    // --- 调用代码 ---
    subroutines_call: function (item) {
      return (item.name || '') + '(' + eCallArgs(item.params) + ')';
    },

    dllCommands_call: function (item) {
      return (item.name || '') + '(' + eCallArgs(item.params) + ')';
    },

    classes_call: function (item, methodName, className) {
      if (methodName) {
        var prefix = className ? className + '.' : '';
        var method = (item.methods || []).find(function (m) { return m.name === methodName; });
        return prefix + methodName + '(' + eCallArgs(method ? method.params : []) + ')';
      }
      var cn = item.name || '';
      return (item.methods || []).map(function (m) {
        return cn + '.' + m.name + '(' + eCallArgs(m.params) + ')';
      }).join('\n');
    },

    dataTypes_call: function (item) {
      return item.name || '';
    },

    globalVars_call: function (item) {
      return item.name || '';
    },

    constants_call: function (item) {
      return item.name || '';
    },

    // --- 参数声明 ---
    subroutines_params: function (item) {
      var params = item.params || [];
      if (params.length === 0) return '';
      return '.版本 2\n\n' + params.map(function (p) { return formatEParam(p, '参考'); }).join('\n');
    },

    dllCommands_params: function (item) {
      var params = item.params || [];
      if (params.length === 0) return '';
      return '.版本 2\n\n' + params.map(function (p) { return formatEParam(p, '传址'); }).join('\n');
    },

    classes_params: function (item, methodName) {
      if (methodName) {
        var method = (item.methods || []).find(function (m) { return m.name === methodName; });
        var params = method ? (method.params || []) : [];
        if (params.length === 0) return '';
        return '.版本 2\n\n' + params.map(function (p) { return formatEParam(p, '参考'); }).join('\n');
      }
      var methods = item.methods || [];
      var parts = [];
      methods.forEach(function (m) {
        var params = m.params || [];
        if (params.length > 0) {
          parts.push('.版本 2\n\n' + params.map(function (p) { return formatEParam(p, '参考'); }).join('\n'));
        }
      });
      return parts.join('\n\n');
    },

    dataTypes_params: function (item) {
      var members = item.members || [];
      if (members.length === 0) return '';
      return '.版本 2\n\n' + members.map(function (m) {
        var parts = ['.成员 ' + (m.name || '')];
        parts.push(m.dataType || '');
        parts.push(m.byRef ? '传址' : '');
        var arrayStr = '';
        if (m.isArray && m.arrayDims && m.arrayDims.length > 0) {
          arrayStr = m.arrayDims.join(', ');
        }
        parts.push('"' + arrayStr + '"');
        parts.push(m.remark || '');
        return parts.join(', ');
      }).join('\n');
    },

    globalVars_params: function () { return ''; },
    constants_params: function () { return ''; },

    // --- 变量声明 ---
    classes_varDecl: function (item) {
      var name = item.name || '';
      return '.版本 2\n\n.参数 ' + name + ', ' + name;
    },

    dataTypes_varDecl: function (item) {
      var name = item.name || '';
      return '.版本 2\n\n.参数 ' + name + ', ' + name;
    },

    // --- 声明代码 / 签名 ---
    subroutines_decl: function (item) {
      var name = item.name || '';
      var returnType = item.returnType || '';
      var remark = item.remark || '';
      var params = item.params || [];
      var header = '.子程序 ' + name + ', ' + returnType + ', , ' + remark;
      if (params.length === 0) return '.版本 2\n\n' + header;
      var paramStr = params.map(function (p) { return formatEParam(p, '参考'); }).join('\n');
      return '.版本 2\n\n' + header + '\n' + paramStr;
    },

    dllCommands_decl: function (item) {
      var name = item.name || '';
      var returnType = item.returnType || '整数型';
      var fileName = item.fileName || '';
      var cmdName = item.cmdName || '';
      var params = item.params || [];
      var header = '.DLL命令 ' + name + ', ' + returnType + ', "' + fileName + '", "' + cmdName + '", 公开';
      if (params.length === 0) return '.版本 2\n\n' + header;
      var paramStr = params.map(function (p) {
        return '    ' + formatEParam(p, '传址');
      }).join('\n');
      return '.版本 2\n\n' + header + ', \n' + paramStr;
    },

    classes_decl: function (item, methodName) {
      var methods = item.methods || [];
      if (methodName) {
        var method = methods.find(function (m) { return m.name === methodName; });
        if (!method) return '';
        return formatMethodDecl(method);
      }
      return methods.map(formatMethodDecl).join('\n\n');
    },

    dataTypes_decl: function (item) {
      var name = item.name || '';
      var remark = item.remark || '';
      var members = item.members || [];
      var header = '.数据类型 ' + name + ', 公开';
      if (remark) header += ', ' + remark;
      if (members.length === 0) return '.版本 2\n\n' + header;
      var memberStr = members.map(function (m) {
        var parts = ['    .成员 ' + (m.name || '')];
        parts.push(m.dataType || '');
        parts.push(m.byRef ? '传址' : '');
        var arrayStr = '';
        if (m.isArray && m.arrayDims && m.arrayDims.length > 0) {
          arrayStr = m.arrayDims.join(', ');
        }
        parts.push('"' + arrayStr + '"');
        parts.push(m.remark || '');
        return parts.join(', ');
      }).join('\n');
      return '.版本 2\n\n' + header + '\n' + memberStr;
    },

    globalVars_decl: function (item) {
      var name = item.name || '';
      var dataType = item.dataType || '整数型';
      var arrayStr = '';
      if (item.isArray) {
        if (item.arrayDims && item.arrayDims.length > 0) {
          arrayStr = item.arrayDims.join(', ');
        } else {
          arrayStr = '数组';
        }
      }
      var remark = item.remark || '';
      return '.版本 2\n\n.全局变量 ' + name + ', ' + dataType + ', ' + arrayStr + ', ' + (remark ? '"' + remark + '"' : '');
    },

    globalVars_varDecl: function (item) {
      return item.name || '';
    },

    constants_constName: function (item) {
      return '#' + (item.name || '');
    },

    constants_decl: function (item) {
      var name = item.name || '';
      var val = item.value !== undefined ? String(item.value) : '';
      if (typeof item.value === 'string') val = '"' + val + '"';
      var remark = item.remark || '';
      return '.版本 2\n\n.常量 ' + name + ', ' + val + ', , ' + remark;
    }
  };

  registerGenerator('e', eGenerator);

  // --- 暴露接口 ---

  window.CodeCopy = {
    register: registerGenerator,
    generate: generateCode
  };
})();
