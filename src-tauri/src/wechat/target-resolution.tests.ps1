$ErrorActionPreference = 'Stop'
function Row($name,$id='') { return @{Name=$name;Id=$id} }
function Check($rows,$target,$count,$truncated=$false) {
    $result = Resolve-SearchRows $rows $target
    if ($result.Indices.Count -ne $count -or $result.Truncated -ne $truncated) {
        throw "Target classification failed: count=$($result.Indices.Count), truncated=$($result.Truncated)"
    }
}
Check @((Row '功能'),(Row '文件传输助手' 'search_item_function_文件传输助手'),(Row '聊天记录'),(Row '文件传输助手')) '文件传输助手' 1
Check @((Row '联系人'),(Row 'Exact Contact' 'search_item_Exact Contact'),(Row '聊天记录'),(Row 'Exact Contact')) 'Exact Contact' 1
Check @((Row '群聊'),(Row 'Exact Group' 'search_item_Exact Group')) 'Exact Group' 1
Check @((Row '联系人'),(Row 'Same' 'search_item_Same'),(Row 'Same' 'search_item_Same')) 'Same' 2
Check @((Row '联系人'),(Row 'Same' 'search_item_Same'),(Row '群聊'),(Row 'Same' 'search_item_Same')) 'Same' 2
Check @((Row '联系人'),(Row 'Same' 'search_item_Same'),(Row '群聊'),(Row '查看全部(20)')) 'Same' 1 $true
Check @((Row '聊天记录'),(Row 'Same' 'search_item_Same'),(Row '收藏'),(Row 'Same')) 'Same' 0
Check @((Row '联系人'),(Row 'same' 'search_item_same')) 'Same' 0
Check @((Row '未知分组'),(Row 'Same' 'search_item_Same')) 'Same' 0
Check @((Row '群聊'),(Row 'Same' 'search_item_contact_123')) 'Same' 0
Check @((Row 'Contacts'),(Row 'Same' 'search_item_contact_123')) 'Same' 1
Check @() 'Missing' 0
Check @((Row '最常使用'),(Row 'Same' 'search_item_Same')) 'Same' 1
Check @((Row '最常使用'),(Row 'Same' 'search_item_Same'),(Row '查看全部(20)')) 'Same' 1 $true
Write-Output '14 target classification fixtures passed'
